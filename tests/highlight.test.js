'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const childProcess = require('node:child_process');
const highlight = require('../js/highlight');

function settings(overrides = {}) {
  return Object.assign({
    x: 100, y: 200, width: 100, height: 80, rotation: 0,
    shape: 'rectangle', radius: 20,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    layers: [{ id: 'one', name: '枠', color: '#ff0000', width: 4, glow: 0, opacity: 1, offset: 0, enabled: true }]
  }, overrides);
}
function pixel(image, x, y) {
  const px = Math.floor(x) + image.padding, py = Math.floor(y) + image.padding;
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return [0, 0, 0, 0];
  const start = (py * image.width + px) * 4;
  return Array.from(image.pixels.subarray(start, start + 4));
}
function alpha(image, x, y) { return pixel(image, x, y)[3]; }

test('border-only rectangle leaves the image interior transparent and includes outer stroke padding', () => {
  const image = highlight.raster(settings());
  assert.equal(image.padding, 5);
  assert.equal(image.width, 110);
  assert.equal(image.height, 90);
  assert.deepEqual(pixel(image, 50, 0), [255, 0, 0, 255]);
  assert.equal(alpha(image, 50, 40), 0);
  assert.equal(alpha(image, 50, -2), 255);
  assert.equal(alpha(image, 50, -3), 0);
  for (let x = -image.padding; x < 100 + image.padding; x++) assert.equal(alpha(image, x, -image.padding), 0);
});

test('positive offsets move the ring outward and negative offsets move it inward', () => {
  const outward = settings(); outward.layers[0].width = 2; outward.layers[0].offset = 8;
  const image = highlight.raster(outward);
  assert.equal(image.padding, 12);
  assert.equal(alpha(image, 50, -9), 255);
  assert.equal(alpha(image, 50, 0), 0);
  const inward = settings(); inward.layers[0].width = 2; inward.layers[0].offset = -8;
  const inset = highlight.raster(inward);
  assert.equal(inset.padding, 3);
  assert.equal(alpha(inset, 50, 7), 255);
  assert.equal(alpha(inset, 50, 0), 0);
});

test('glow fades from the stroke and terminates within the allocated padding', () => {
  const p = settings(); p.layers[0].width = 2; p.layers[0].glow = 4;
  const image = highlight.raster(p);
  assert.equal(image.padding, 16);
  assert.ok(alpha(image, 50, -3) > alpha(image, 50, -7));
  assert.ok(alpha(image, 50, -7) > 0);
  assert.equal(alpha(image, 50, -15), 0);
  assert.equal(alpha(image, 50, 40), 0);
});

test('ordered alpha-over layers preserve straight colors and disabled layers have no effect', () => {
  const p = settings(); p.layers[0].opacity = 0.5;
  p.layers.push({ id: 'two', name: '青', color: '#0000ff', width: 4, glow: 0, offset: 0, opacity: 0.5, enabled: true });
  p.layers.push({ id: 'disabled', name: '緑', color: '#00ff00', width: 80, glow: 80, offset: 120, opacity: 1, enabled: false });
  const image = highlight.raster(p);
  assert.deepEqual(pixel(image, 50, 0), [85, 0, 170, 191]);
  assert.equal(image.padding, 5);
  p.layers.reverse();
  assert.deepEqual(pixel(highlight.raster(p), 50, 0), [170, 0, 85, 191]);
  const translucent = settings(); translucent.layers[0].opacity = 0.25;
  assert.deepEqual(pixel(highlight.raster(translucent), 50, 0), [255, 0, 0, 64]);
});

test('rounded corners cut the media mask and trace the same bounded corner radius', () => {
  const rounded = settings({ shape: 'rounded' });
  const roundedMask = highlight.mask(rounded), squareMask = highlight.mask(settings());
  assert.equal(roundedMask.padding, 0);
  assert.equal(alpha(roundedMask, 0, 0), 0);
  assert.equal(alpha(squareMask, 0, 0), 255);
  assert.equal(alpha(roundedMask, 50, 40), 255);
  assert.equal(alpha(highlight.raster(rounded), 0, 0), 0);
  assert.equal(alpha(highlight.raster(rounded), 50, 0), 255);
  const calls = [];
  const ctx = Object.fromEntries(['beginPath', 'moveTo', 'lineTo', 'arcTo', 'rect', 'closePath'].map(name => [name, (...args) => calls.push([name, ...args])]));
  highlight.trace(ctx, settings({ shape: 'rounded', radius: 200 }));
  assert.equal(calls[0][0], 'beginPath');
  assert.equal(calls.at(-1)[0], 'closePath');
  assert.equal(calls.filter(call => call[0] === 'arcTo').length, 4);
  assert.ok(calls.filter(call => call[0] === 'arcTo').every(call => call.at(-1) === 40));
});

test('concave polygons clip their notch and draw both inner and outer perimeter edges', () => {
  const p = settings({ shape: 'polygon', width: 100, height: 100, points: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 },
    { x: 0.4, y: 0.4 }, { x: 0.4, y: 1 }, { x: 0, y: 1 }
  ] });
  const image = highlight.mask(p), border = highlight.raster(p);
  assert.equal(alpha(image, 20, 80), 255);
  assert.equal(alpha(image, 80, 20), 255);
  assert.equal(alpha(image, 80, 80), 0);
  assert.equal(alpha(border, 39, 70), 255);
  assert.equal(alpha(border, 70, 39), 255);
  assert.equal(alpha(border, 20, 80), 0);
  p.points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const triangle = highlight.mask(p);
  assert.equal(alpha(triangle, 20, 20), 255);
  assert.equal(alpha(triangle, 80, 80), 0);
  assert.ok(alpha(triangle, 49, 50) > 0 && alpha(triangle, 49, 50) < 255);
});

test('preview scaling applies to geometry, stroke, glow, offset and corner radius together', () => {
  const p = settings({ shape: 'rounded', width: 200, height: 160, radius: 40 });
  p.layers[0].width = 8; p.layers[0].offset = 8; p.layers[0].glow = 4;
  const image = highlight.raster(p, 0.5);
  assert.equal(image.padding, 15); // ceil(4 + 2 + 6) + 3
  assert.equal(image.width, 130);
  assert.equal(image.height, 110);
  assert.equal(alpha(image, 50, -4), 255);
  assert.equal(alpha(image, 50, 30), 0);
  const mediaMask = highlight.mask(p, 0.5);
  assert.equal(mediaMask.width, 100); assert.equal(mediaMask.height, 80);
  assert.equal(alpha(mediaMask, 0, 0), 0);
  assert.equal(alpha(mediaMask, 50, 40), 255);
});

test('browser UMD and CEP mixed context need no Node dependencies for pixel generation', () => {
  const window = {}, module = { exports: {} };
  const sandbox = vm.createContext({ window, module });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/highlight.js'), 'utf8'), sandbox);
  assert.equal(window.CardHighlight, module.exports);
  const image = window.CardHighlight.raster(settings());
  assert.deepEqual(pixel(image, 50, 0), [255, 0, 0, 255]);
  assert.throws(() => window.CardHighlight.encodePNG(image), /Node.js/);
});

test('PNG encoder writes RGBA scanlines and round-trips actual partially transparent border pixels', t => {
  const p = settings({ shape: 'rounded', width: 40, height: 32, radius: 8 });
  p.layers[0].glow = 2; p.layers[0].opacity = 0.6;
  const image = highlight.raster(p), png = highlight.encodePNG(image);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), image.width);
  assert.equal(png.readUInt32BE(20), image.height);
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(zlib.inflateSync(Buffer.concat(compressed)).length, (image.width * 4 + 1) * image.height);
  const available = childProcess.spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (available.status !== 0) { t.diagnostic('FFmpeg is unavailable; PNG structure verified, decoder round-trip omitted.'); return; }
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: png, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  assert.deepEqual(result.stdout, Buffer.from(image.pixels));
});

test('zero-width non-glowing layers remain transparent and malformed layer colors are rejected', () => {
  const p = settings(); p.layers[0].width = 0;
  const image = highlight.raster(p);
  assert.ok(image.pixels.every(value => value === 0));
  p.layers[0].color = 'red';
  assert.throws(() => highlight.raster(p), /カラーコード/);
});
