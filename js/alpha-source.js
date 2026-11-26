'use strict';
const { spawn } = require('child_process');

// Some WebM decoders expose the color stream without the separate VP8/VP9 alpha planes.
function webmDecoder(log) {
  if (!/alpha_mode\s*:\s*1/i.test(log)) return null;
  const codec = /Video:\s*(vp8|vp9)\b/i.exec(log);
  return codec ? (codec[1].toLowerCase() === 'vp9' ? 'libvpx-vp9' : 'libvpx') : null;
}

function canCarryAlpha(format) {
  // A palette can carry per-entry transparency. An unknown format gets checked as well.
  return !format || /^(?:rgba|bgra|argb|abgr|yuva|gbrap|ya\d|ayuv|vuya|vuy[a4]|uyva|pal8|gray\d+a)/i.test(format);
}

function decodeError(message, details) {
  const error = new Error(message);
  error.code = 'MEDIA_DECODE_FAILED';
  error.technicalDetails = details;
  return error;
}

// Read exactly one source plane at a time. Both the async iterator and the encoder's
// stdin honor backpressure, even for long clips. Nothing is written to the source.
async function* readFrames(options) {
  const { size, signal, fps, duration, single } = options;
  const cancelled = () => Object.assign(new Error('書き出しを中止しました。'), { code: 'CANCELLED' });
  if (signal && signal.aborted) throw cancelled();
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-filter_threads', '1'];
  if (options.offset) args.push('-ss', String(options.offset));
  if (options.displayFrame && options.offset) args.push('-noaccurate_seek');
  if (options.decoder) args.push('-c:v', options.decoder);
  args.push('-i', options.path, '-map', '0:v:0', '-an', '-sn', '-dn');
  const filters = [];
  // Browser seeks display the last presented frame at or before the playhead.
  // Keep pre-seek timestamps until fps has selected that frame, including at EOF.
  if (options.displayFrame && options.offset) filters.push('fps=1000:start_time=0:round=up');
  filters.push('setpts=PTS-STARTPTS', 'format=rgba', 'alphaextract', 'scale=' + size.width + ':' + size.height + ':flags=area');
  if (!single) filters.push('fps=' + fps, 'tpad=stop_mode=clone:stop_duration=' + duration, 'trim=duration=' + duration);
  args.push('-vf', filters.join(','));
  if (single) args.push('-frames:v', '1');
  args.push('-threads', '1', '-c:v', 'rawvideo', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1');
  const child = spawn(options.ffmpegPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let details = '', launchError, exited = false;
  child.stderr.on('data', chunk => { details = (details + chunk).slice(-6000); });
  child.on('error', error => { launchError = error; });
  const done = new Promise(resolve => child.once('close', code => { exited = true; resolve(code); }));
  const stop = () => { if (!exited) child.kill(); };
  if (signal) signal.addEventListener('abort', stop, { once: true });
  const length = size.width * size.height;
  let plane, used = 0, frames = 0;
  try {
    for await (const chunk of child.stdout) {
      let pos = 0;
      while (pos < chunk.length) {
        if (!plane) plane = Buffer.allocUnsafe(length);
        const count = Math.min(length - used, chunk.length - pos);
        chunk.copy(plane, used, pos, pos + count); used += count; pos += count;
        if (used === length) {
          frames++; yield plane; used = 0; plane = null;
        }
      }
    }
    const code = await done;
    if (signal && signal.aborted) throw cancelled();
    if (launchError) throw launchError;
    if (code !== 0 || used || !frames) throw decodeError('素材の透明度を読み取れませんでした。', details);
  } finally {
    stop();
    if (signal) signal.removeEventListener('abort', stop);
    await done;
  }
}

async function firstFrame(options) {
  let result;
  for await (const plane of readFrames(Object.assign({}, options, { single: true }))) result = plane;
  return result;
}

module.exports = { canCarryAlpha, webmDecoder, readFrames, firstFrame };
