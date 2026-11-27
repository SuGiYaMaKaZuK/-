'use strict';

// This module is loaded only by CEP's Node context. Media paths are always
// separate spawn arguments: no shell, command concatenation, or filter escaping.
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const model = require('./model');
const highlight = require('./highlight');
const alphaSource = require('./alpha-source');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const activeCards = model.activeCards;

function failure(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.technicalDetails = String(details).slice(-6000);
  return error;
}

function cardLabel(card, index) {
  const name = typeof card.name === 'string' ? card.name.replace(/[\r\n]/g, ' ').trim().slice(0, 100) : '';
  return 'カード' + (index + 1) + (name ? '「' + name + '」' : '');
}

function cancelled() { return failure('CANCELLED', '書き出しを中止しました。'); }

function launchFailure(error) {
  if (error.code === 'ENOENT') return failure('FFMPEG_NOT_FOUND', 'FFmpegが見つかりません。FFmpegの場所を設定するか、インストールし直してください。', error.message);
  if (error.code === 'EACCES' || error.code === 'EPERM') return failure('FFMPEG_PERMISSION', 'FFmpegを起動する権限がありません。FFmpegの場所とWindowsのセキュリティ設定を確認してください。', error.message);
  return failure('FFMPEG_START_FAILED', 'FFmpegを起動できません。FFmpegの場所を確認して、もう一度お試しください。', error.message);
}

function renderFailure(project, details, outputPath, sourceOverride) {
  const inputs = activeCards(project).map(function (card, index) { return { card: card, index: index }; }).filter(function (item) { return item.card.mediaPath; });
  let source = sourceOverride || inputs.find(function (item) { return details.indexOf(item.card.mediaPath) !== -1; });
  if (!source) {
    const match = /(?:stream\s+#|input\s+#|\[in#)(\d+)/i.exec(details);
    if (match) source = inputs[Number(match[1])];
  }
  const label = source ? cardLabel(source.card, source.index) : '画像・動画の素材';
  if (source && /No such file or directory|File not found/i.test(details)) return failure('MEDIA_NOT_FOUND', label + 'の素材ファイルが見つかりません。移動・削除されていないか確認し、素材を選び直してください。', details);
  if (source && /Permission denied|Access is denied|Operation not permitted/i.test(details) && (!outputPath || details.indexOf(outputPath) === -1)) return failure('MEDIA_PERMISSION', label + 'の素材ファイルを開けません。ファイルの読み取り権限を確認するか、別の場所にコピーして選び直してください。', details);
  if (/Invalid data found|Error opening input|Decoder.*not found|Error while decoding|Invalid.*header|could not find codec parameters|does not contain any stream|matches no streams|Cannot determine format of input stream|Could not find.*codec|unsupported.*codec|Unknown decoder|Error.*demux/i.test(details)) {
    return failure('MEDIA_DECODE_FAILED', label + 'を読み込めません。素材を選び直すか、PNG・JPEG画像やMP4動画に変換してお試しください。', details);
  }
  if (/No space left on device|Disk quota exceeded/i.test(details)) return failure('OUTPUT_DISK_FULL', '書き出し先の空き容量が足りません。空き容量を増やすか、別の保存先を選んでください。', details);
  if (/Permission denied|Access is denied|Read-only file system|Error opening output|Failed to open.*output|Could not open.*output/i.test(details)) return failure('OUTPUT_WRITE_FAILED', '動画を保存できません。保存先の権限を確認し、別のフォルダーを選んでください。', details);
  return failure('RENDER_FAILED', '動画を書き出せませんでした。素材と保存先を確認して、もう一度お試しください。', details);
}

function number(value, label, min, max, integer) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(label + ' の値が不正です。');
  }
  return value;
}

function color(value, label) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(label + ' は #RRGGBB で指定してください。');
  return '0x' + value.slice(1);
}

function validate(project, outputPath) {
  if (!project || typeof project !== 'object') throw new Error('演出設定がありません。');
  number(project.width, '幅', 64, 7680, true);
  number(project.height, '高さ', 64, 4320, true);
  if (project.width % 2 || project.height % 2) throw new Error('出力サイズは偶数にしてください。');
  number(project.fps, 'フレームレート', 1, 120);
  number(project.duration, '全体の長さ', 0.1, 600);
  number(project.cardWidth, 'カード幅', 8, 4096, true);
  number(project.cardHeight, 'カード高さ', 8, 4096, true);
  number(project.dropDuration, '降下時間', 0.01, 60);
  number(project.flipDuration, 'めくり時間', 0.01, 60);
  color(project.backColor, '裏面の色');
  color(project.borderColor, '枠の色');
  if (!Array.isArray(project.cards) || project.cards.length < 1 || project.cards.length > 12) throw new Error('カードは1〜12枚にしてください。');
  if (project.backgroundMode && ['transparent', 'solid'].indexOf(project.backgroundMode) === -1) throw new Error('背景は透過または単色にしてください。');
  if (project.backgroundMode === 'solid') color(project.backgroundColor, '背景の色');
  const splitCount = model.splitCount(project);
  if (splitCount) {
    if (project.cards.length < splitCount) throw new Error(splitCount+'分割には素材を'+splitCount+'つ用意してください。');
    const split = model.splitSettings(project);
    if (!split || typeof split !== 'object') throw new Error(splitCount+'分割の設定がありません。');
    if (project.mode === 'quad' && !['columns','grid'].includes(split.layout)) throw new Error('4分割の配置を選び直してください。');
    number(split.angle, '傾きの角度', -20, 20);
    number(split.borderWidth, '境界線の太さ', 0, 64);
    color(split.borderColor, '境界線の色');
    number(split.slideDuration, 'スライド時間', 0.05, 10);
    number(split.interval, '登場の間隔', 0, 30);
    number(split.startAt, '登場開始時刻', 0, project.duration);
    if (model.splitEnd(project) > project.duration + 0.000001) throw new Error(splitCount+'枚目のスライドが終わるように演出の長さを延ばしてください。');
  }
  if (project.mode === 'highlight') {
    const highlight = project.highlight;
    if (!highlight || typeof highlight !== 'object') throw new Error('画像の縁取りの設定がありません。');
    number(highlight.x, '縁取り画像のX位置', -2 * project.width, 2 * project.width);
    number(highlight.y, '縁取り画像のY位置', -2 * project.height, 2 * project.height);
    number(highlight.width, '縁取り画像の幅', 16, 3840, true);
    number(highlight.height, '縁取り画像の高さ', 16, 2160, true);
    number(highlight.rotation, '縁取り画像の回転', -180, 180);
    number(highlight.radius, '縁取り画像の角丸', 0, 500);
    if (highlight.followAlpha !== undefined && typeof highlight.followAlpha !== 'boolean') throw new Error('透過素材の輪郭設定を確認してください。');
    if (['rounded', 'rectangle', 'polygon'].indexOf(highlight.shape) === -1) throw new Error('縁取りの形を選び直してください。');
    if (highlight.shape === 'polygon') {
      if (!Array.isArray(highlight.points) || highlight.points.length < 3 || highlight.points.length > 12) throw new Error('多角形の頂点は3〜12個にしてください。');
      highlight.points.forEach(function (point, index) {
        if (!point || typeof point !== 'object') throw new Error('多角形の頂点' + (index + 1) + 'の位置が不正です。');
        number(point.x, '多角形の頂点' + (index + 1) + 'のX位置', 0, 1);
        number(point.y, '多角形の頂点' + (index + 1) + 'のY位置', 0, 1);
      });
    }
    if (!Array.isArray(highlight.layers) || highlight.layers.length > 12) throw new Error('線のレイヤーは0〜12枚にしてください。');
    highlight.layers.forEach(function (layer, index) {
      const label = '線のレイヤー' + (index + 1);
      if (!layer || typeof layer !== 'object') throw new Error(label + 'の設定が不正です。');
      color(layer.color, label + 'の色');
      number(layer.width, label + 'の太さ', 0, 80);
      number(layer.glow, label + 'の光の広がり', 0, 80);
      number(layer.opacity, label + 'の不透明度', 0, 1);
      number(layer.offset, label + 'の位置', -80, 120);
      if (typeof layer.enabled !== 'boolean') throw new Error(label + 'の表示設定が不正です。');
    });
  }
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.mov') throw new Error('書き出し先は絶対パスの .mov ファイルにしてください。');
  activeCards(project).forEach(function (card, index) {
    const label = cardLabel(card, index);
    if (!splitCount && project.mode !== 'highlight') {
      number(card.x, label + 'のX位置', -7680, 15360);
      number(card.y, label + 'のY位置', -4320, 8640);
      number(card.dropAt, label + 'の登場時刻', 0, project.duration);
      number(card.flipAt, label + 'のめくり時刻', 0, project.duration);
      if (card.flipAt < card.dropAt) throw new Error(label + 'は登場後にめくってください。');
      if (card.flipAt + project.flipDuration > project.duration + 0.000001) throw new Error(label + 'のめくりが演出の長さを超えています。');
    }
    number(card.mediaOffset || 0, label + 'の素材開始位置', 0, 86400);
    number(card.mediaScale === undefined ? 100 : card.mediaScale, label + 'の素材の拡大率', 10, 400);
    number(card.mediaX === undefined ? 0 : card.mediaX, label + 'の素材のX位置', -2 * project.width, 2 * project.width);
    number(card.mediaY === undefined ? 0 : card.mediaY, label + 'の素材のY位置', -2 * project.height, 2 * project.height);
    if (card.mediaPath) {
      if (typeof card.mediaPath !== 'string' || !path.isAbsolute(card.mediaPath)) throw failure('MEDIA_PATH_INVALID', label + 'の素材ファイルを選び直してください。ファイルの場所が正しくありません。');
      let info;
      try { info = fs.statSync(card.mediaPath); } catch (error) {
        if (error.code === 'EACCES' || error.code === 'EPERM') throw failure('MEDIA_PERMISSION', label + 'の素材ファイルを開けません。読み取り権限を確認するか、別の場所にコピーして選び直してください。', error.message);
        throw failure('MEDIA_NOT_FOUND', label + 'の素材ファイルが見つかりません。移動・削除されていないか確認し、素材を選び直してください。', error.message);
      }
      if (!info.isFile()) throw failure('MEDIA_PATH_INVALID', label + 'の素材はフォルダーになっています。画像または動画のファイルを選んでください。');
      if (info.size === 0) throw failure('MEDIA_EMPTY', label + 'の素材ファイルは空です。画像・動画が正常に保存されているか確認し、素材を選び直してください。');
      if (card.mediaType !== 'image' && card.mediaType !== 'video') throw new Error(label + 'の素材の種類が不正です。');
      if (path.resolve(card.mediaPath).toLowerCase() === path.resolve(outputPath).toLowerCase()) throw new Error('素材ファイル自身へは上書きできません。');
    }
  });
}

// A seek past EOF can silently draw no front media; a damaged image used with
// an infinite image loop can repeatedly fail decoding. Check a single frame
// without looping before encoding, using the bundled FFmpeg (no ffprobe).
async function checkMedia(project, options) {
  const cards = activeCards(project);
  const sources = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card.mediaPath) continue;
    sources[index] = await new Promise(function (resolve, reject) {
      if (options.signal && options.signal.aborted) { reject(cancelled()); return; }
      let child;
      const args = ['-hide_banner', '-nostdin', '-loglevel', 'info'];
      if (card.mediaType === 'video' && card.mediaOffset > 0) args.push('-ss', String(card.mediaOffset));
      args.push('-i', card.mediaPath, '-map', '0:v:0', '-vf', 'showinfo', '-frames:v', '1', '-an', '-sn', '-dn', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-');
      try { child = childProcess.spawn(options.ffmpegPath || 'ffmpeg', args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { reject(launchFailure(error)); return; }
      let stdout = '';
      let details = '';
      let dimensionBuffer = '';
      let dimensions = null, pixelFormat, header = '';
      let aborted = false;
      const abort = function () { aborted = true; child.kill(); };
      if (options.signal) options.signal.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', function (chunk) { stdout = (stdout + chunk.toString()).slice(-2000); });
      child.stderr.on('data', function (chunk) {
        const text = chunk.toString();
        // showinfo's frame line can precede large HDR/SEI side data. Remember
        // dimensions as they arrive, independently of the truncated error log.
        if (!dimensions && header.length < 32768) header += text.slice(0, 32768 - header.length);
        dimensionBuffer += text;
        const format = /\bfmt:(\w+)\s/.exec(dimensionBuffer);
        if (format) pixelFormat = format[1];
        const size = /\bs:(\d+)x(\d+)\b/.exec(dimensionBuffer);
        if (size) dimensions = { width: Number(size[1]), height: Number(size[2]) };
        dimensionBuffer = dimensionBuffer.slice(-512);
        details = (details + text).slice(-6000);
      });
      child.on('error', function (error) {
        if (options.signal) options.signal.removeEventListener('abort', abort);
        reject(launchFailure(error));
      });
      child.on('close', function (code) {
        if (options.signal) options.signal.removeEventListener('abort', abort);
        if (aborted) { reject(cancelled()); return; }
        if (code !== 0) { reject(renderFailure(project, details, '', { card: card, index: index })); return; }
        if (!/(?:^|\n)frame=\s*[1-9]\d*(?:\r?\n|$)/.test(stdout)) {
          reject(card.mediaType === 'video' && card.mediaOffset > 0
            ? failure('MEDIA_OFFSET_OUT_OF_RANGE', cardLabel(card, index) + 'の素材の開始位置（' + card.mediaOffset + '秒）から再生できる映像がありません。開始位置を短くするか、素材を選び直してください。', details || stdout)
            : failure('MEDIA_DECODE_FAILED', cardLabel(card, index) + 'から画像・映像を読み取れません。正常に再生できる素材を選び直してください。', details || stdout));
          return;
        }
        if (!dimensions || !(dimensions.width > 0 && dimensions.height > 0)) {
          reject(failure('MEDIA_DIMENSIONS_UNKNOWN', cardLabel(card, index) + 'の画像サイズを確認できません。素材を選び直すか、別の画像・動画形式に変換してお試しください。', details));
          return;
        }
        resolve(Object.assign(dimensions, { pixelFormat, decoder: alphaSource.webmDecoder(header) }));
      });
    });
  }
  return sources;
}

// Place the original source in a fixed, transparent frame. Cropping the source
// viewport first avoids a 400% 4K intermediate while preserving cover-fit zoom.
function mediaFrame(graph, input, prefix, width, height, project, card, startsAt, source, fill) {
  const fps = project.fps;
  const duration = project.duration;
  const zoom = (card.mediaScale === undefined ? 100 : card.mediaScale) / 100;
  const panX = card.mediaX === undefined ? 0 : card.mediaX;
  const panY = card.mediaY === undefined ? 0 : card.mediaY;
  let transform;
  let x;
  let y;
  if (source && source.width > 0 && source.height > 0) {
    const rect = model.mediaRect(card, source.width, source.height, width, height);
    const visibleX = Math.max(0, rect.x), visibleY = Math.max(0, rect.y);
    const visibleRight = Math.min(width, rect.x + rect.width), visibleBottom = Math.min(height, rect.y + rect.height);
    if (visibleRight <= visibleX || visibleBottom <= visibleY) {
      const blankTimeline = card.mediaType === 'video' ? ',tpad=start_mode=clone:start_duration=' + startsAt + ':stop_mode=clone:stop_duration=' + duration : '';
      // Keep the source connected to a finite output. An infinite image input
      // attached only to nullsink can otherwise keep the graph alive forever.
      graph.push('[' + input + ':v]setpts=PTS-STARTPTS,format=rgba,scale=1:1,setsar=1,colorchannelmixer=aa=0,pad=' + width + ':' + height + ':0:0:color=black@0,fps=' + fps + blankTimeline + ',trim=duration=' + duration + '[' + prefix + 'blank]');
      graph.push('color=c=' + (fill || 'black@0') + ':s=' + width + 'x' + height + ':r=' + fps + ':d=' + duration + ',format=rgba[' + prefix + 'canvas]');
      graph.push('[' + prefix + 'canvas][' + prefix + 'blank]overlay=0:0:format=auto[' + prefix + 'frame]');
      return prefix + 'frame';
    }
    // Keep two neighboring source pixels for the scaler's interpolation kernel.
    const sourceX = Math.max(0, Math.floor((visibleX - rect.x) * source.width / rect.width) - 2);
    const sourceY = Math.max(0, Math.floor((visibleY - rect.y) * source.height / rect.height) - 2);
    const sourceRight = Math.min(source.width, Math.ceil((visibleRight - rect.x) * source.width / rect.width) + 2);
    const sourceBottom = Math.min(source.height, Math.ceil((visibleBottom - rect.y) * source.height / rect.height) + 2);
    const sourceWidth = sourceRight - sourceX, sourceHeight = sourceBottom - sourceY;
    let scaledWidth = Math.max(1, Math.round(sourceWidth * rect.width / source.width));
    let scaledHeight = Math.max(1, Math.round(sourceHeight * rect.height / source.height));
    x = String(rect.x + Math.round(sourceX * rect.width / source.width));
    y = String(rect.y + Math.round(sourceY * rect.height / source.height));
    // A one-pixel source is constant along that axis; omit any invisible
    // overscan rather than expanding one pixel to many thousands of pixels.
    if (sourceWidth === 1) { scaledWidth = visibleRight - visibleX; x = String(visibleX); }
    if (sourceHeight === 1) { scaledHeight = visibleBottom - visibleY; y = String(visibleY); }
    if (scaledWidth * scaledHeight > 64000000) throw failure('MEDIA_TRANSFORM_TOO_LARGE', '素材を拡大するための画像サイズが大きすぎます。拡大率を下げるか、解像度の高い素材を選んでください。');
    transform = 'crop=w=' + sourceWidth + ':h=' + sourceHeight + ':x=' + sourceX + ':y=' + sourceY + ':exact=1,scale=' + scaledWidth + ':' + scaledHeight;
  } else {
    const factor = 'max(' + width + '/iw,' + height + '/ih)*' + zoom;
    transform = 'scale=w=\'max(1,round(iw*' + factor + '))\':h=\'max(1,round(ih*' + factor + '))\'';
    x = '\'floor((' + width + '-overlay_w)/2+' + panX + '+0.5)\'';
    y = '\'floor((' + height + '-overlay_h)/2+' + panY + '+0.5)\'';
  }
  const timeline = card.mediaType === 'video' ? ',tpad=start_mode=clone:start_duration=' + startsAt + ':stop_mode=clone:stop_duration=' + duration : '';
  graph.push('[' + input + ':v]setpts=PTS-STARTPTS,format=rgba,' + transform + ',setsar=1,fps=' + fps + timeline + ',trim=duration=' + duration + '[' + prefix + 'scaled]');
  graph.push('color=c=' + (fill || 'black@0') + ':s=' + width + 'x' + height + ':r=' + fps + ':d=' + duration + ',format=rgba[' + prefix + 'canvas]');
  graph.push('[' + prefix + 'canvas][' + prefix + 'scaled]overlay=x=' + x + ':y=' + y + ':format=auto[' + prefix + 'frame]');
  return prefix + 'frame';
}

function buildArgs(project, outputPath, sources, assets) {
  validate(project, outputPath);
  if (model.splitCount(project)) return buildSplitArgs(project, outputPath, sources);
  if (project.mode === 'highlight') return buildHighlightArgs(project, outputPath, sources, assets);
  const args = ['-hide_banner', '-y', '-nostdin', '-loglevel', 'warning', '-filter_complex_threads', '1'];
  const graph = [];
  const width = project.cardWidth;
  const height = project.cardHeight;
  const duration = project.duration;
  const fps = project.fps;
  const back = color(project.backColor, '裏面の色');
  const border = color(project.borderColor, '枠の色');
  const thickness = Math.max(1, Math.round(Math.min(width, height) / 80));
  const source = function (fill, w, h) { return 'color=c=' + fill + ':s=' + w + 'x' + h + ':r=' + fps + ':d=' + duration + ',format=rgba'; };
  const background = project.backgroundMode === 'solid' ? color(project.backgroundColor, '背景の色') : 'black@0.0';
  graph.push(source(background, project.width, project.height) + '[base]');
  let input = 0;
  project.cards.forEach(function (card, index) {
    const prefix = 'c' + index;
    const reveal = card.flipAt + project.flipDuration / 2;
    // Front is prepared from timeline zero so that the flip does not jump its
    // media stream. tpad freezes the first frame until the visible reveal.
    if (card.mediaPath) {
      if (card.mediaType === 'image') args.push('-loop', '1', '-framerate', String(fps));
      else if (card.mediaOffset) args.push('-ss', String(card.mediaOffset));
      args.push('-i', card.mediaPath);
      const frame = mediaFrame(graph, input, prefix, width, height, project, card, reveal, sources && sources[index], back);
      graph.push('[' + frame + ']drawbox=x=0:y=0:w=iw:h=ih:color=' + border + ':t=' + thickness + '[' + prefix + 'front]');
      input += 1;
    } else {
      const palette = ['0x7546b8', '0x157d8d', '0xad5c2d', '0x5374ad'];
      graph.push(source(palette[index % palette.length], width, height) + ',drawbox=x=0:y=0:w=iw:h=ih:color=' + border + ':t=' + thickness + '[' + prefix + 'front]');
    }
    graph.push(source(back, width, height) + ',drawbox=x=0:y=0:w=iw:h=ih:color=' + border + ':t=' + thickness + ',drawbox=x=iw*0.12:y=ih*0.08:w=iw*0.76:h=ih*0.84:color=' + border + '@0.38:t=' + thickness + '[' + prefix + 'back]');
    graph.push('[' + prefix + 'back][' + prefix + 'front]overlay=0:0:enable=\'gte(t,' + reveal + ')\':format=auto[' + prefix + 'face]');
    const p = 'clip((t-' + card.flipAt + ')/' + project.flipDuration + ',0,1)';
    const smooth = '(' + p + '*' + p + '*(3-2*' + p + '))';
    // Keep a two-pixel edge at the midpoint to avoid zero-sized filter frames.
    graph.push('[' + prefix + 'face]scale=w=\'max(2,round(' + width + '*abs(cos(PI*' + smooth + '))))\':h=' + height + ':eval=frame,setsar=1[' + prefix + 'flip]');
    const dropP = 'clip((t-' + card.dropAt + ')/' + project.dropDuration + ',0,1)';
    const start = -height / 2 - 40;
    const centerY = '(' + start + '+(' + card.y + '-(' + start + '))*(1-pow(1-' + dropP + ',3)))';
    const previous = index === 0 ? 'base' : 'out' + (index - 1);
    graph.push('[' + previous + '][' + prefix + 'flip]overlay=x=\'' + card.x + '-overlay_w/2\':y=\'' + centerY + '-overlay_h/2\':enable=\'gte(t,' + card.dropAt + ')\':eval=frame:format=auto[out' + index + ']');
  });
  args.push('-filter_complex', graph.join(';'), '-map', '[out' + (project.cards.length - 1) + ']', '-an', '-t', String(duration), '-r', String(fps), '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', '-metadata:s:v:0', 'alpha_mode=1', '-progress', 'pipe:1', '-nostats', outputPath);
  return args;
}

function buildSplitArgs(project, outputPath, sources) {
  const args = ['-hide_banner', '-y', '-nostdin', '-loglevel', 'warning', '-filter_complex_threads', '1'];
  const graph = [];
  const fps = project.fps;
  const duration = project.duration;
  const settings = model.splitSettings(project);
  const polygons = model.splitPolygons(project);
  const background = project.backgroundMode === 'solid' ? color(project.backgroundColor, '背景の色') : 'black@0.0';
  graph.push('color=c=' + background + ':s=' + project.width + 'x' + project.height + ':r=' + fps + ':d=' + duration + ',format=rgba[base]');
  let input = 0;
  activeCards(project).forEach(function (card, index) {
    const prefix = 's' + index;
    const points = polygons[index];
    const {x:left, y:top, width, height} = model.splitBounds(points);
    const dropAt = settings.startAt + index * settings.interval;
    const leftSlope = (points[3].x - points[0].x) / height;
    const rightSlope = (points[2].x - points[1].x) / height;
    const leftEdge = '(' + (points[0].x - left) + '+(' + leftSlope + ')*Y)';
    const rightEdge = '(' + (points[1].x - left) + '+(' + rightSlope + ')*Y)';
    const inside = '(gte(X,' + leftEdge + ')*lt(X,' + rightEdge + '))';
    // Compute static masks once, then repeat the single frame. No per-pixel
    // polygon expression is evaluated during each 60/90/120fps media frame.
    const repeat = ',loop=loop=-1:size=1:start=0,setpts=N/(' + fps + '*TB),trim=duration=' + duration;
    if (card.mediaPath) {
      if (card.mediaType === 'image') args.push('-loop', '1', '-framerate', String(fps));
      else if (card.mediaOffset) args.push('-ss', String(card.mediaOffset));
      if (sources && sources[index] && sources[index].decoder) args.push('-c:v',sources[index].decoder);
      args.push('-i', card.mediaPath);
      const frame = mediaFrame(graph, input, prefix, width, height, project, card, dropAt, sources && sources[index]);
      graph.push('[' + frame + ']null[' + prefix + 'media]');
      input += 1;
    } else {
      const palette = ['0x7546b8', '0x157d8d', '0xad5c2d', '0x5374ad'];
      graph.push('color=c=' + palette[index] + ':s=' + width + 'x' + height + ':r=' + fps + ':d=' + duration + ',format=rgba[' + prefix + 'media]');
    }
    let layer = prefix + 'media';
    if (leftSlope || rightSlope || points[0].x !== left || points[1].x !== left+width) {
      graph.push('color=white:s=' + width + 'x' + height + ':r=' + fps + ':d=' + (1 / fps) + ',format=gray,geq=lum=\'255*' + inside + '\'' + repeat + '[' + prefix + 'mask]');
      graph.push('[' + layer + ']split[' + prefix + 'rgb][' + prefix + 'alphaSource]');
      graph.push('[' + prefix + 'alphaSource]alphaextract[' + prefix + 'alpha]');
      graph.push('[' + prefix + 'alpha][' + prefix + 'mask]blend=all_mode=multiply[' + prefix + 'maskedAlpha]');
      graph.push('[' + prefix + 'rgb][' + prefix + 'maskedAlpha]alphamerge[' + prefix + 'clipped]');
      layer = prefix + 'clipped';
    }
    if (settings.borderWidth > 0) {
      const edges = [];
      if (points[0].x > 0) edges.push('lte(abs(X-' + leftEdge + ')/' + Math.sqrt(1 + leftSlope * leftSlope) + ',' + settings.borderWidth / 2 + ')');
      if (points[1].x < project.width) edges.push('lte(abs(X-' + rightEdge + ')/' + Math.sqrt(1 + rightSlope * rightSlope) + ',' + settings.borderWidth / 2 + ')');
      if (top > 0) edges.push('lte(Y,' + settings.borderWidth / 2 + ')');
      if (top+height < project.height) edges.push('lte(' + height + '-Y,' + settings.borderWidth / 2 + ')');
      const boundary = 'min(1,' + edges.join('+') + ')*' + inside;
      graph.push('color=c=' + color(settings.borderColor, '境界線の色') + ':s=' + width + 'x' + height + ':r=' + fps + ':d=' + (1 / fps) + ',format=rgba,geq=r=\'r(X,Y)\':g=\'g(X,Y)\':b=\'b(X,Y)\':a=\'255*(' + boundary + ')\'' + repeat + '[' + prefix + 'border]');
      graph.push('[' + layer + '][' + prefix + 'border]overlay=0:0:format=auto[' + prefix + 'layer]');
      layer = prefix + 'layer';
    }
    const previous = index === 0 ? 'base' : 'out' + (index - 1);
    const progress = 'clip((t-' + dropAt + ')/' + settings.slideDuration + ',0,1)';
    graph.push('[' + previous + '][' + layer + ']overlay=x=' + left + ':y=\'' + top + '-' + (top+height) + '*pow(1-' + progress + ',3)\':enable=\'gte(t,' + dropAt + ')\':eval=frame:format=auto[out' + index + ']');
  });
  args.push('-filter_complex', graph.join(';'), '-map', '[out'+(polygons.length-1)+']', '-an', '-t', String(duration), '-r', String(fps), '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', '-metadata:s:v:0', 'alpha_mode=1', '-progress', 'pipe:1', '-nostats', outputPath);
  return args;
}

function buildHighlightArgs(project, outputPath, sources, assets) {
  if (!assets || (!assets.videoBorders && !(assets.borderPath && fs.existsSync(assets.borderPath))) || !assets.maskPath || !fs.existsSync(assets.maskPath)) {
    throw failure('HIGHLIGHT_ASSETS_REQUIRED', '縁取りの描画データがありません。書き出し処理から実行してください。');
  }
  number(assets.width, '縁取りの描画幅', 16, 8192, true);
  number(assets.height, '縁取りの描画高さ', 16, 8192, true);
  number(assets.padding, '縁取りの描画余白', 0, 2048, true);
  const settings = project.highlight;
  if (assets.width !== settings.width + 2 * assets.padding || assets.height !== settings.height + 2 * assets.padding) throw failure('HIGHLIGHT_ASSETS_INVALID', '縁取りの描画サイズが合いません。書き出しをやり直してください。');
  const args = ['-hide_banner', '-y', '-nostdin', '-loglevel', 'warning', '-filter_complex_threads', '1'];
  const graph = [];
  const fps = project.fps, duration = project.duration;
  const card = project.cards[0];
  let input = 0;
  let frame;
  if (card.mediaPath) {
    if (card.mediaType === 'image') args.push('-loop', '1', '-framerate', String(fps));
    else if (card.mediaOffset) args.push('-ss', String(card.mediaOffset));
    if (sources && sources[0] && sources[0].decoder) args.push('-c:v', sources[0].decoder);
    args.push('-i', card.mediaPath);
    frame = mediaFrame(graph, input, 'highlight', settings.width, settings.height, project, card, 0, sources && sources[0]);
    input += 1;
  } else {
    graph.push('color=c=0x7546b8:s=' + settings.width + 'x' + settings.height + ':r=' + fps + ':d=' + duration + ',format=rgba[highlightFrame]');
    frame = 'highlightFrame';
  }
  const borderInput = input++;
  const maskInput = input;
  let borderStream = borderInput + ':v', maskStream = 'highlightMask';
  if (assets.videoBorders) {
    // The extra scanline carries one flag for this frame: keep the source's full
    // alpha (255), or use the selected geometric crop on an opaque source (0).
    args.push('-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', assets.width + 'x' + (assets.height + 1), '-framerate', String(fps), '-i', 'pipe:0');
    graph.push('[' + borderStream + ']split[borderRows][modeRow]');
    graph.push('[borderRows]crop=' + assets.width + ':' + assets.height + ':0:0:exact=1[subjectBorder]');
    graph.push('[modeRow]crop=1:1:0:' + assets.height + ':exact=1,alphaextract,scale=' + settings.width + ':' + settings.height + ':flags=neighbor[subjectMode]');
    borderStream = 'subjectBorder';
  } else args.push('-loop', '1', '-framerate', String(fps), '-i', assets.borderPath);
  args.push('-loop', '1', '-framerate', String(fps), '-i', assets.maskPath);
  graph.push('[' + maskInput + ':v]format=rgba,alphaextract[highlightMask]');
  if (assets.videoBorders) {
    graph.push('[highlightMask][subjectMode]blend=all_mode=lighten[activeShapeMask]');
    maskStream = 'activeShapeMask';
  }
  graph.push('[' + frame + ']split[highlightRGB][highlightAlphaSource]');
  graph.push('[highlightAlphaSource]alphaextract[highlightAlpha]');
  graph.push('[highlightAlpha][' + maskStream + ']blend=all_mode=multiply[highlightMaskedAlpha]');
  graph.push('[highlightRGB][highlightMaskedAlpha]alphamerge[highlightClipped]');
  graph.push('[highlightClipped]pad=' + assets.width + ':' + assets.height + ':' + assets.padding + ':' + assets.padding + ':color=black@0[highlightPadded]');
  graph.push('[highlightPadded][' + borderStream + ']overlay=0:0:format=auto[highlightDecorated]');
  let rotated = 'highlightDecorated';
  if (settings.rotation === 90 || settings.rotation === -90) {
    graph.push('[highlightDecorated]transpose=' + (settings.rotation === 90 ? 'clock' : 'cclock') + '[highlightRotated]');
    rotated = 'highlightRotated';
  } else if (Math.abs(settings.rotation) === 180) {
    graph.push('[highlightDecorated]hflip,vflip[highlightRotated]');
    rotated = 'highlightRotated';
  } else if (settings.rotation !== 0) {
    const radians = settings.rotation * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians)), sine = Math.abs(Math.sin(radians));
    const outputWidth = Math.max(1, Math.ceil(assets.width * cosine + assets.height * sine - 1e-9));
    const outputHeight = Math.max(1, Math.ceil(assets.height * cosine + assets.width * sine - 1e-9));
    graph.push('[highlightDecorated]rotate=a=' + radians + ':ow=' + outputWidth + ':oh=' + outputHeight + ':c=black@0[highlightRotated]');
    rotated = 'highlightRotated';
  }
  const background = project.backgroundMode === 'solid' ? color(project.backgroundColor, '背景の色') : 'black@0';
  graph.push('color=c=' + background + ':s=' + project.width + 'x' + project.height + ':r=' + fps + ':d=' + duration + ',format=rgba[highlightBackground]');
  graph.push('[highlightBackground][' + rotated + ']overlay=x=\'' + settings.x + '-overlay_w/2\':y=\'' + settings.y + '-overlay_h/2\':format=auto[highlightOutput]');
  args.push('-filter_complex', graph.join(';'), '-map', '[highlightOutput]', '-an', '-t', String(duration), '-r', String(fps), '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', '-metadata:s:v:0', 'alpha_mode=1', '-progress', 'pipe:1', '-nostats', outputPath);
  return args;
}

async function writeHighlightAssets(project, directory, source, options) {
  const settings = project.highlight, card = project.cards[0];
  const assets = Object.assign(highlight.frameSize(settings, 1), {
    borderPath: path.join(directory, 'border.png'), maskPath: path.join(directory, 'mask.png')
  });
  let maskSettings = settings;
  const follow = settings.followAlpha !== false && source && (source.decoder || alphaSource.canCarryAlpha(source.pixelFormat));
  if (follow) {
    const rect = model.mediaRect(card, source.width, source.height, settings.width, settings.height);
    const size = highlight.sampleSize(source.width, source.height, rect, 1, 16000000);
    const decode = { size, path: card.mediaPath, offset: card.mediaType === 'video' ? card.mediaOffset : 0,
      decoder: source.decoder, ffmpegPath: options.ffmpegPath || 'ffmpeg', fps: project.fps, duration: project.duration };
    let opaqueBorder;
    function border(alpha, transparent) {
      if (transparent) return highlight.raster(settings, 1, { alpha, width: size.width, height: size.height, rect });
      if (!opaqueBorder) opaqueBorder = highlight.raster(settings, 1);
      return opaqueBorder;
    }
    if (card.mediaType === 'video') {
      assets.videoBorders = async function* (signal) {
        let lastPlane, pixels, transparent;
        const shapeRow = Buffer.alloc(4 * assets.width), subjectRow = Buffer.alloc(shapeRow.length);
        subjectRow[3] = 255;
        for await (const plane of alphaSource.readFrames(Object.assign({}, decode, { signal }))) {
          if (!lastPlane || !lastPlane.equals(plane)) {
            transparent = plane.some(value => value !== 255);
            const rgba = border(plane, transparent).pixels;
            pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
            lastPlane = plane;
          }
          yield pixels; yield transparent ? subjectRow : shapeRow;
        }
      };
    } else {
      const alpha = await alphaSource.firstFrame(Object.assign({}, decode, { signal: options.signal }));
      const transparent = alpha.some(value => value !== 255);
      if (transparent) maskSettings = Object.assign({}, settings, { shape: 'rectangle' });
      fs.writeFileSync(assets.borderPath, highlight.encodePNG(border(alpha, transparent)));
    }
  } else fs.writeFileSync(assets.borderPath, highlight.encodePNG(highlight.raster(settings, 1)));
  fs.writeFileSync(assets.maskPath, highlight.encodePNG(highlight.mask(maskSettings, 1)));
  return assets;
}

async function render(project, options) {
  options = options || {};
  validate(project, options.outputPath);
  if (options.signal && options.signal.aborted) throw cancelled();
  const sources = await checkMedia(project, options);
  let assetDirectory;
  try {
    let assets;
    if (project.mode === 'highlight') {
      assetDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'card-reveal-highlight-'));
      assets = await writeHighlightAssets(project, assetDirectory, sources[0], options);
    }
    return await new Promise(function (resolve, reject) {
    let args;
    let temporaryPath;
    try {
      validate(project, options.outputPath);
      temporaryPath = path.join(path.dirname(options.outputPath), '.' + path.basename(options.outputPath) + '.' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '.mov');
      args = buildArgs(project, temporaryPath, sources, assets);
    } catch (error) { reject(error); return; }
    const ffmpegPath = options.ffmpegPath || 'ffmpeg';
    if (options.signal && options.signal.aborted) { reject(cancelled()); return; }
    let process, feedError, encoderError, encoderClosed = false;
    const feed = assets && assets.videoBorders ? new AbortController() : null;
    try { process = childProcess.spawn(ffmpegPath, args, { shell: false, windowsHide: true, stdio: [feed ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); } catch (error) { reject(launchFailure(error)); return; }
    let errors = '';
    let progressBuffer = '';
    let aborted = false;
    const abort = function () { aborted = true; if (feed) feed.abort(); process.kill(); };
    const supplied = feed ? pipeline(Readable.from(assets.videoBorders(feed.signal), { objectMode: false }), process.stdin).catch(function (error) {
      if (!encoderClosed && !aborted && error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        feedError = error; process.kill();
      }
      feed.abort();
    }) : Promise.resolve();
    if (options.signal) options.signal.addEventListener('abort', abort, { once: true });
    process.stderr.on('data', function (chunk) { errors = (errors + chunk.toString()).slice(-6000); });
    process.stdout.on('data', function (chunk) {
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop();
      lines.forEach(function (line) {
        const match = /^out_time_us=(\d+)$/.exec(line);
        if (match && typeof options.onProgress === 'function') options.onProgress(Math.min(0.999, Number(match[1]) / 1000000 / project.duration));
      });
    });
    process.on('error', function (error) {
      encoderError = launchFailure(error);
      if (feed) feed.abort();
    });
    process.on('close', async function (code) {
      encoderClosed = true;
      if (feed) feed.abort();
      await supplied;
      if (options.signal) options.signal.removeEventListener('abort', abort);
      if (aborted || encoderError || feedError || code !== 0) {
        // A failed movie must not be mistaken for a complete render.
        try { fs.unlinkSync(temporaryPath); } catch (_) { /* no partial output */ }
        reject(aborted ? cancelled() : (encoderError || feedError || renderFailure(project, errors, temporaryPath)));
        return;
      }
      try { fs.renameSync(temporaryPath, options.outputPath); } catch (error) {
        try { fs.unlinkSync(temporaryPath); } catch (_) { /* no partial output */ }
        reject(failure('OUTPUT_SAVE_FAILED', '完成した動画を保存できません。保存先が他のアプリで開かれていないか確認するか、別の保存先を選んでください。', error.message));
        return;
      }
      if (typeof options.onProgress === 'function') options.onProgress(1);
      resolve({ outputPath: options.outputPath });
    });
    });
  } finally {
    if (assetDirectory) fs.rmSync(assetDirectory, { recursive: true, force: true });
  }
}

module.exports = { buildArgs: buildArgs, render: render };
