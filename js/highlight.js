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
    var inside = new Uint8Array(frame.width * frame.height), peak = 0;
    // The threshold stays low enough for fine hair, and adapts to faint artwork.
    for (var i = 0; i < alpha.length && peak < 32; i++) peak = Math.max(peak, alpha[i]);
    if (!peak) return null;
    var threshold = Math.min(16, peak / 2), leftEdge = geom.width, topEdge = geom.height, rightEdge = -1, bottomEdge = -1;
    var scaleX = sw / rect.width, scaleY = sh / rect.height;
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
        if (a * (1 - fy) + b * fy < threshold) continue;
        inside[(y + frame.padding) * frame.width + x + frame.padding] = 1;
        leftEdge = Math.min(leftEdge, x); rightEdge = Math.max(rightEdge, x);
        topEdge = Math.min(topEdge, y); bottomEdge = y;
      }
    }
    if (rightEdge < 0) return null;
    // Transparent margins beyond the furthest layer need no distance field.
    var width = rightEdge - leftEdge + 1 + frame.padding * 2, height = bottomEdge - topEdge + 1 + frame.padding * 2;
    if (width === frame.width && height === frame.height) return { x: 0, y: 0, width: width, height: height, inside: inside };
    var cropped = new Uint8Array(width * height);
    for (var row = 0; row < height; row++) {
      var start = (row + topEdge) * frame.width + leftEdge;
      cropped.set(inside.subarray(start, start + width), row * width);
    }
    return { x: leftEdge, y: topEdge, width: width, height: height, inside: cropped };
  }
  // Exact Euclidean distance to opposite-class pixel centers, in two separable passes.
  // Subtract half a pixel to place a straight edge between the two centers.
  function silhouetteDistances(inside, width, height) {
    var field = new Float32Array(inside.length), result = new Float32Array(inside.length);
    var sites = new Int32Array(width), limits = new Float64Array(width);
    var far = width + height + 1;
    for (var target = 0; target <= 1; target++) {
      for (var x = 0; x < width; x++) {
        var d = far;
        for (var i = x; i < field.length; i += width) { d = inside[i] === target ? 0 : Math.min(d + 1, far); field[i] = d; }
        d = far;
        for (i = field.length - width + x; i >= 0; i -= width) {
          d = Math.min(d + 1, field[i]); field[i] = d * d;
        }
      }
      for (var row = 0; row < field.length; row += width) {
        var last = 0; sites[0] = 0; limits[0] = -Infinity;
        for (var q = 1; q < width; q++) {
          var crossing;
          while (true) {
            var p = sites[last];
            crossing = ((field[row + q] - field[row + p]) / (q - p) + q + p) / 2;
            if (crossing > limits[last]) break;
            last--;
          }
          last++; sites[last] = q; limits[last] = crossing;
        }
        var active = 0;
        for (q = 0; q < width; q++) {
          while (active < last && limits[active + 1] < q) active++;
          if (inside[row + q] === target) continue;
          var nearest = sites[active], dx = q - nearest;
          var edge = Math.sqrt(dx * dx + field[row + nearest]) - 0.5;
          result[row + q] = target ? edge : -edge;
        }
      }
    }
    return result;
  }
  function raster(settings, scale, source) {
    scale = scale === undefined ? 1 : scale;
    var geom = geometry(settings, scale), stack = layers(settings, scale), size = frameSize(settings, scale);
    var padding = size.padding, result = allocate(geom, padding), count = result.width * result.height, distances, region;
    if (!stack.length) return result;
    if (source) {
      region = placedSilhouette(geom, source, scale, result);
      if (!region) return result;
      distances = silhouetteDistances(region.inside, region.width, region.height);
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
      var red = 0, green = 0, blue = 0, alpha = 0;
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
      }
      var byteAlpha = Math.round(alpha * 255);
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
