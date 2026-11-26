'use strict';
const model = require('../js/model');

function project() {
  const p = model.createProject();
  Object.assign(p, { width: 128, height: 96, mode: 'highlight', fps: 10, duration: 0.6 });
  Object.assign(p.highlight, { x: 64, y: 48, width: 96, height: 64, shape: 'rectangle', radius: 0,
    layers: [{ name: '輪郭', id: 'edge', width: 3, glow: 1, offset: 1, opacity: 1, enabled: true, color: '#ffff00' }] });
  return p;
}
function sprite(shift = 0, empty = false) {
  const width = 96, height = 64, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const local = x - shift;
    const body = local >= 17 && local < 49 && y >= 13 && y < 53;
    const hole = local >= 26 && local < 41 && y >= 24 && y < 40;
    const dot = local >= 61 && local < 66 && y >= 11 && y < 16;
    const hair = local === 21 && y >= 8 && y < 13;
    const a = empty ? 0 : (body && !hole ? 255 : dot || hair ? 96 : 0);
    pixels.set([15, 74, 185, a], (y * width + x) * 4);
  }
  return { width, height, pixels };
}
module.exports = { project, sprite };
