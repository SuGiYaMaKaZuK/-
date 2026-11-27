(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CardHighlight = api;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function number(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(name + 'の値が不正です。');
    return value;
  }
  function geometry(settings, scale) {
    if (!settings || typeof settings !== 'object') throw new Error('強調枠の設定がありません。');
    number(scale, '描画倍率', 0.001, 16);
    var width = Math.max(1, Math.round(number(settings.width, '枠の幅', 1, 16384) * scale));
    var height = Math.max(1, Math.round(number(settings.height, '枠の高さ', 1, 16384) * scale));
    var shape = settings.shape;
    if (shape !== 'rectangle' && shape !== 'rounded' && shape !== 'polygon') throw new Error('強調枠の形が不正です。');
    var result = { width: width, height: height, shape: shape, radius: 0, points: null };
    if (shape === 'rounded') result.radius = Math.min(number(settings.radius === undefined ? 32 : settings.radius, '角の丸み', 0, 16384) * scale, width / 2, height / 2);
    if (shape === 'polygon') {
      if (!Array.isArray(settings.points) || settings.points.length < 3 || settings.points.length > 12) throw new Error('多角形は3〜12個の頂点で指定してください。');
      result.points = settings.points.map(function (point) {
        if (!point || typeof point !== 'object') throw new Error('多角形の頂点が不正です。');
        return { x: number(point.x, '頂点のX位置', 0, 1) * width, y: number(point.y, '頂点のY位置', 0, 1) * height };
      });
    }
    return result;
  }
  function layers(settings, scale) {
    if (!Array.isArray(settings.layers) || settings.layers.length > 12) throw new Error('強調枠のレイヤーは12個以内で指定してください。');
    return settings.layers.filter(function (layer) { return layer && layer.enabled !== false; }).map(function (layer) {
      if (!/^#[0-9a-f]{6}$/i.test(layer.color || '')) throw new Error('枠の色は6桁のカラーコードで指定してください。');
      return {
        red: parseInt(layer.color.slice(1, 3), 16), green: parseInt(layer.color.slice(3, 5), 16), blue: parseInt(layer.color.slice(5, 7), 16),
        width: number(layer.width, '線の太さ', 0, 80) * scale,
        glow: number(layer.glow, '発光の広さ', 0, 80) * scale,
        offset: number(layer.offset, '線の位置', -80, 120) * scale,
        opacity: number(layer.opacity, '不透明度', 0, 1)
      };
    });
  }
  function distance(geom, x, y) {
    if (geom.shape !== 'polygon') {
      var qx = Math.abs(x - geom.width / 2) - geom.width / 2 + geom.radius;
      var qy = Math.abs(y - geom.height / 2) - geom.height / 2 + geom.radius;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - geom.radius;
    }
    var nearest = Infinity, inside = false, points = geom.points;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
      var a = points[j], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
      var length2 = dx * dx + dy * dy;
      var t = length2 > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / length2, 0, 1) : 0;
      var ex = x - a.x - t * dx, ey = y - a.y - t * dy;
      nearest = Math.min(nearest, ex * ex + ey * ey);
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(nearest);
  }
  function allocate(geom, padding) {
    var width = geom.width + 2 * padding, height = geom.height + 2 * padding;
    if (width * height > 32000000) throw new Error('強調枠の描画サイズが大きすぎます。サイズか描画倍率を下げてください。');
    return { width: width, height: height, padding: padding, pixels: new Uint8Array(width * height * 4) };
  }
  function frameSize(settings, scale) {
    var geom = geometry(settings, scale), stack = layers(settings, scale), reach = 0;
    stack.forEach(function (layer) { reach = Math.max(reach, layer.offset + layer.width / 2 + 3 * layer.glow); });
    var padding = Math.ceil(Math.max(0, reach)) + 3;
    return { width: geom.width + padding * 2, height: geom.height + padding * 2, padding: padding };
  }
  // Sample only the alpha plane for the outline. The original color media takes its own path.
  function sampleSize(width, height, rect, scale, maxPixels) {
    var factor = Math.min(1, Math.max(rect.width * scale / width, rect.height * scale / height), Math.sqrt(maxPixels / (width * height)));
    return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
  }
  function alphaPlane(rgba) {
    var count = rgba.length / 4, alpha = null;
    for (var i = 0; i < count; i++) {
      var value = rgba[i * 4 + 3];
      if (value !== 255 && !alpha) { alpha = new Uint8Array(count); alpha.fill(255, 0, i); }
      if (alpha) alpha[i] = value;
    }
    return alpha;
  }
  function placedSilhouette(geom, source, scale, frame) {
    var rect = source.rect, sw = source.width, sh = source.height, alpha = source.alpha;
    if (!alpha || alpha.length !== sw * sh || !rect || !(rect.width > 0 && rect.height > 0)) throw new Error('素材の透明度を読み取れません。');
    var coverage = new Uint8Array(frame.width * frame.height), peak = 0;
    // The threshold stays low enough for fine hair, and adapts to faint artwork.
    for (var i = 0; i < alpha.length && peak < 32; i++) peak = Math.max(peak, alpha[i]);
    if (!peak) return null;
    var threshold = Math.min(16, peak / 2), leftEdge = geom.width, topEdge = geom.height, rightEdge = -1, bottomEdge = -1;
    var scaleX = sw / rect.width, scaleY = sh / rect.height, minAlpha = 255, maxAlpha = 0;
    for (var y = 0; y < geom.height; y++) {
      var localY = (y + 0.5) / scale - rect.y;
      if (localY < 0 || localY >= rect.height) continue;
      var sy = clamp(localY * scaleY - 0.5, 0, sh - 1), top = Math.floor(sy), bottom = Math.min(top + 1, sh - 1), fy = sy - top;
      for (var x = 0; x < geom.width; x++) {
        var localX = (x + 0.5) / scale - rect.x;
        if (localX < 0 || localX >= rect.width) continue;
        var sx = clamp(localX * scaleX - 0.5, 0, sw - 1), left = Math.floor(sx), right = Math.min(left + 1, sw - 1), fx = sx - left;
        var a = alpha[top * sw + left] * (1 - fx) + alpha[top * sw + right] * fx;
        var b = alpha[bottom * sw + left] * (1 - fx) + alpha[bottom * sw + right] * fx;
        var value = Math.round(a * (1 - fy) + b * fy);
        coverage[(y + frame.padding) * frame.width + x + frame.padding] = value;
        if (value < threshold) continue;
        minAlpha = Math.min(minAlpha, value); maxAlpha = Math.max(maxAlpha, value);
        leftEdge = Math.min(leftEdge, x); rightEdge = Math.max(rightEdge, x);
        topEdge = Math.min(topEdge, y); bottomEdge = y;
      }
    }
    if (rightEdge < 0) return null;
    // Transparent margins beyond the furthest layer need no distance field.
    var width = rightEdge - leftEdge + 1 + frame.padding * 2, height = bottomEdge - topEdge + 1 + frame.padding * 2;
    var region = { x: leftEdge, y: topEdge, width: width, height: height, coverage: coverage, threshold: threshold,
      uniformOpacity: minAlpha === maxAlpha ? maxAlpha / 255 : null };
    if (width === frame.width && height === frame.height) return region;
    var cropped = new Uint8Array(width * height);
    for (var row = 0; row < height; row++) {
      var start = (row + topEdge) * frame.width + leftEdge;
      cropped.set(coverage.subarray(start, start + width), row * width);
    }
    region.coverage = cropped;
    return region;
  }
  // Average the material opacity near each output pixel. Carrying the alpha of
  // one nearest edge pixel into the halo produces radial streaks around curves.
  function localOpacity(region) {
    var width = region.width, height = region.height, alpha = region.coverage;
    // Binning bounds the two summed-area tables to about 4 MiB. Contour
    // distances and the original color image still use their full resolution.
    var step = Math.max(1, Math.ceil(Math.sqrt(alpha.length / 262144)));
    var cols = Math.ceil(width / step), rows = Math.ceil(height / step), stride = cols + 1;
    var weights = new Float64Array(stride * (rows + 1)), weightedAlpha = new Float64Array(weights.length);
    for (var y = 0; y < height; y++) {
      var dest = (Math.floor(y / step) + 1) * stride + 1;
      for (var x = 0; x < width; x++) {
        var a = alpha[y * width + x];
        if (a < region.threshold) continue;
        var bin = dest + Math.floor(x / step);
        var weight = a * a;
        weights[bin] += weight; weightedAlpha[bin] += a * weight;
      }
    }
    for (y = 1; y <= rows; y++) {
      var totalWeight = 0, totalAlpha = 0;
      for (x = 1; x <= cols; x++) {
        var i = y * stride + x;
        totalWeight += weights[i]; totalAlpha += weightedAlpha[i];
        weights[i] = weights[i - stride] + totalWeight; weightedAlpha[i] = weightedAlpha[i - stride] + totalAlpha;
      }
    }
    // A fractional box follows the contour smoothly as its radius changes.
    function prefix(table, x, y) {
      var ix = Math.min(Math.floor(x), cols - 1), iy = Math.min(Math.floor(y), rows - 1);
      var fx = x - ix, fy = y - iy, i = iy * stride + ix;
      var top = table[i] * (1 - fx) + table[i + 1] * fx;
      var bottom = table[i + stride] * (1 - fx) + table[i + stride + 1] * fx;
      return top * (1 - fy) + bottom * fy;
    }
    function box(table, left, top, right, bottom) {
      return prefix(table, right, bottom) - prefix(table, left, bottom) - prefix(table, right, top) + prefix(table, left, top);
    }
    return function (x, y, distance) {
      var radius = distance + 2.5;
      var left = Math.max(0, (x + 0.5 - radius) / step), right = Math.min(cols, (x + 0.5 + radius) / step);
      var top = Math.max(0, (y + 0.5 - radius) / step), bottom = Math.min(rows, (y + 0.5 + radius) / step);
      var weight = box(weights, left, top, right, bottom);
      return weight > 0 ? clamp(box(weightedAlpha, left, top, right, bottom) / (255 * weight), 0, 1) : 0;
    };
  }
  // Distance to the nearest contour. Keep the nearest row as well as the distance
  // so a partially covered edge pixel can place the outer line between pixels.
  function silhouetteDistances(region, includeInterior, reach) {
    var coverage = region.coverage, threshold = region.threshold, width = region.width, height = region.height;
    var field = new Float32Array(coverage.length), result = new Float32Array(coverage.length);
    var sites = new Int32Array(width), limits = new Float64Array(width);
    var verticalSquared = new Float32Array(width), edgeInset = new Float32Array(width);
    var opacityAt = region.uniformOpacity === null ? localOpacity(region) : null;
    var far = width + height + 1;
    // An exterior outline only needs distances to foreground pixels.
    for (var target = includeInterior ? 0 : 1; target <= 1; target++) {
      var foreground = target === 1;
      for (var x = 0; x < width; x++) {
        var d = far;
        for (var i = x; i < field.length; i += width) { d = (coverage[i] >= threshold) === foreground ? 0 : Math.min(d + 1, far); field[i] = d; }
        d = far;
        for (i = field.length - width + x; i >= 0; i -= width) {
          d = (coverage[i] >= threshold) === foreground ? 0 : Math.min(d + 1, far);
          if (d < field[i]) field[i] = -d;
        }
      }
      for (var row = 0; row < field.length; row += width) {
        for (var col = 0; col < width; col++) {
          var dy = field[row + col];
          verticalSquared[col] = dy * dy;
          edgeInset[col] = 0;
          if (foreground && Math.abs(dy) < far) {
            var seed = row + col - dy * width, value = coverage[seed], peak = value;
            // A feathered opaque edge and a translucent wisp may have the same
            // alpha at their tips. A 3x3 neighborhood captures the local material
            // opacity. All foreground sites have at least three pixels of padding.
            if (value < 255) peak = Math.max(value, coverage[seed-1], coverage[seed+1],
              coverage[seed-width-1], coverage[seed-width], coverage[seed-width+1],
              coverage[seed+width-1], coverage[seed+width], coverage[seed+width+1]);
            edgeInset[col] = 1 - value / peak;
          }
        }
        var last = 0; sites[0] = 0; limits[0] = -Infinity;
        for (var q = 1; q < width; q++) {
          var crossing;
          while (true) {
            var p = sites[last];
            crossing = ((verticalSquared[q] - verticalSquared[p]) / (q - p) + q + p) / 2;
            if (crossing > limits[last]) break;
            last--;
          }
          last++; sites[last] = q; limits[last] = crossing;
        }
        var active = 0;
        for (q = 0; q < width; q++) {
          while (active < last && limits[active + 1] < q) active++;
          var nearest = sites[active], dx = q - nearest;
          // The final pass reuses this row of scratch storage for the exterior matte.
          if (foreground) field[row + q] = 0;
          if ((coverage[row + q] >= threshold) === foreground) continue;
          var edge = Math.sqrt(dx * dx + verticalSquared[nearest]) - 0.5;
          if (foreground && edge <= reach) {
            var opacity = opacityAt ? opacityAt(q, row / width, edge) : region.uniformOpacity;
            field[row + q] = (1 - coverage[row + q] / threshold) * opacity;
            edge += edgeInset[nearest] / (1 + edge);
          }
          result[row + q] = target ? edge : -edge;
        }
      }
    }
    return { distances: result, exterior: field };
  }
  function raster(settings, scale, source) {
    scale = scale === undefined ? 1 : scale;
    var geom = geometry(settings, scale), stack = layers(settings, scale), size = frameSize(settings, scale);
    var padding = size.padding, result = allocate(geom, padding), count = result.width * result.height, distances, exteriorMatte, region, includeInterior = false;
    if (!stack.length) return result;
    if (source) {
      region = placedSilhouette(geom, source, scale, result);
      if (!region) return result;
      includeInterior = stack.some(function (layer) { return layer.offset < 0 && layer.opacity > 0 && (layer.width > 0 || layer.glow > 0); });
      var outlined = silhouetteDistances(region, includeInterior, padding);
      distances = outlined.distances; exteriorMatte = outlined.exterior;
      count = distances.length;
    } else {
      distances = new Float32Array(count);
      for (var y = 0; y < result.height; y++) {
        for (var x = 0; x < result.width; x++) distances[y * result.width + x] = distance(geom, x + 0.5 - padding, y + 0.5 - padding);
      }
    }
    // Accumulate premultiplied RGB in scalars to avoid four more full-frame
    // buffers. Only the reusable distance field and the output occupy the frame.
    for (var pixel = 0; pixel < count; pixel++) {
      // Keep an exterior layer off the artwork, including translucent hair and fabric.
      // Taper through the very faint fringe rather than creating a hard alpha cutoff.
      var exterior = exteriorMatte ? exteriorMatte[pixel] : 1;
      if (!exterior && !includeInterior) continue;
      var red = 0, green = 0, blue = 0, alpha = 0;
      var innerRed = 0, innerGreen = 0, innerBlue = 0, innerAlpha = 0;
      for (var layerIndex = 0; layerIndex < stack.length; layerIndex++) {
        var layer = stack[layerIndex];
        if (!layer.opacity || (!layer.width && !layer.glow)) continue;
        var halfWidth = layer.width / 2;
        var fromCenter = Math.abs(distances[pixel] - layer.offset);
        var fromBand = Math.max(0, fromCenter - halfWidth);
        var stroke = layer.width > 0 ? clamp(halfWidth + 0.5 - fromCenter, 0, Math.min(1, layer.width)) : 0;
        var glow = layer.glow > 0 && fromBand <= 3 * layer.glow ? 0.65 * Math.exp(-fromBand * fromBand / (2 * layer.glow * layer.glow)) : 0;
        var coverage = Math.max(stroke, glow) * layer.opacity;
        if (!coverage) continue;
        var remainder = 1 - coverage;
        red = layer.red * coverage + red * remainder;
        green = layer.green * coverage + green * remainder;
        blue = layer.blue * coverage + blue * remainder;
        alpha = coverage + alpha * remainder;
        if (includeInterior && layer.offset < 0 && exterior < 1) {
          innerRed = layer.red * coverage + innerRed * remainder;
          innerGreen = layer.green * coverage + innerGreen * remainder;
          innerBlue = layer.blue * coverage + innerBlue * remainder;
          innerAlpha = coverage + innerAlpha * remainder;
        }
      }
      // The whole exterior stack shares one material matte, even where its
      // individual light layers overlap. Explicit inset layers keep their order.
      if (includeInterior && exterior < 1) {
        red = red * exterior + innerRed * (1 - exterior);
        green = green * exterior + innerGreen * (1 - exterior);
        blue = blue * exterior + innerBlue * (1 - exterior);
        alpha = alpha * exterior + innerAlpha * (1 - exterior);
      }
      var byteAlpha = Math.round(alpha * (includeInterior ? 1 : exterior) * 255);
      if (!byteAlpha) continue;
      var offset = region ? ((region.y + Math.floor(pixel / region.width)) * result.width + region.x + pixel % region.width) * 4 : pixel * 4;
      result.pixels[offset] = Math.round(clamp(red / alpha, 0, 255));
      result.pixels[offset + 1] = Math.round(clamp(green / alpha, 0, 255));
      result.pixels[offset + 2] = Math.round(clamp(blue / alpha, 0, 255));
      result.pixels[offset + 3] = byteAlpha;
    }
    return result;
  }
  function mask(settings, scale) {
    var geom = geometry(settings, scale === undefined ? 1 : scale), result = allocate(geom, 0);
    for (var y = 0; y < result.height; y++) {
      for (var x = 0; x < result.width; x++) {
        var offset = (y * result.width + x) * 4;
        result.pixels[offset] = result.pixels[offset + 1] = result.pixels[offset + 2] = 255;
        result.pixels[offset + 3] = Math.round(clamp(0.5 - distance(geom, x + 0.5, y + 0.5), 0, 1) * 255);
      }
    }
    return result;
  }
  function trace(ctx, settings) {
    var geom = geometry(settings, 1), width = geom.width, height = geom.height, radius = geom.radius;
    ctx.beginPath();
    if (geom.shape === 'polygon') {
      geom.points.forEach(function (point, index) { if (!index) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
    } else if (radius > 0) {
      ctx.moveTo(radius, 0); ctx.lineTo(width - radius, 0); ctx.arcTo(width, 0, width, radius, radius);
      ctx.lineTo(width, height - radius); ctx.arcTo(width, height, width - radius, height, radius);
      ctx.lineTo(radius, height); ctx.arcTo(0, height, 0, height - radius, radius);
      ctx.lineTo(0, radius); ctx.arcTo(0, 0, radius, 0, radius);
    } else ctx.rect(0, 0, width, height);
    ctx.closePath();
  }

  var crcTable;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var value = n;
        for (var k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        crcTable[n] = value >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function encodePNG(image) {
    var nodeRequire = typeof require === 'function' ? require : (typeof window !== 'undefined' && window.cep_node && window.cep_node.require);
    if (!nodeRequire) throw new Error('PNGの保存にはNode.jsが必要です。');
    var BufferClass = nodeRequire('buffer').Buffer, zlib = nodeRequire('zlib');
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 32000000 || !image.pixels || image.pixels.length !== image.width * image.height * 4) throw new Error('PNG画像の形式が正しくありません。');
    var source = BufferClass.from(image.pixels), rowLength = image.width * 4;
    var filtered = BufferClass.alloc((rowLength + 1) * image.height);
    for (var y = 0; y < image.height; y++) source.copy(filtered, y * (rowLength + 1) + 1, y * rowLength, (y + 1) * rowLength);
    function chunk(type, data) {
      var typeBytes = BufferClass.from(type, 'ascii'), result = BufferClass.alloc(data.length + 12);
      result.writeUInt32BE(data.length, 0); typeBytes.copy(result, 4); data.copy(result, 8);
      result.writeUInt32BE(crc32(result.subarray(4, data.length + 8)), data.length + 8);
      return result;
    }
    var header = BufferClass.alloc(13);
    header.writeUInt32BE(image.width, 0); header.writeUInt32BE(image.height, 4); header[8] = 8; header[9] = 6;
    return BufferClass.concat([
      BufferClass.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
      chunk('IDAT', zlib.deflateSync(filtered)), chunk('IEND', BufferClass.alloc(0))
    ]);
  }
  return { frameSize: frameSize, sampleSize: sampleSize, alphaPlane: alphaPlane, raster: raster, mask: mask, trace: trace, encodePNG: encodePNG };
}));
