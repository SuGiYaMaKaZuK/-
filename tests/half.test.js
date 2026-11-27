'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const model = require('../js/model');
const library = require('../js/library');
const media = require('../js/media-library');
const { encodePNG } = require('../js/highlight');
const { render, buildArgs } = require('../js/render');

test('the half template keeps two equal frames and its own sources, timing and saved layout', () => {
  const project = library.baseProject('half');
  assert.equal(project.cards.length, 2);
  assert.equal(project.half.layout, 'columns');
  const [first, second] = project.cards;
  Object.assign(first, { mediaPath:'/assets/first.png', mediaType:'image' });
  Object.assign(second, { mediaPath:'/assets/second.mov', mediaType:'video', mediaOffset:1.5 });

  for (const [width, height] of [[322, 182], [1080, 1920]]) {
    Object.assign(project, { width, height });
    for (const layout of ['columns', 'rows']) {
      project.half.layout = layout;
      const rows = layout === 'rows';
      const w = rows ? width : width / 2;
      const h = rows ? height / 2 : height;
      const frames = model.splitPolygons(project).map(model.splitBounds);
      assert.deepEqual(frames, [
        { x:0, y:0, width:w, height:h },
        { x:rows ? 0 : w, y:rows ? h : 0, width:w, height:h }
      ]);
      const placement = library.placementFrom(project, second.id);
      assert.deepEqual([placement.frameWidth, placement.frameHeight], [w, h]);
      const before = model.splitPose(project, 1, 0);
      assert.equal(before.visible, false);
      const arrival = model.splitPose(project, 1, project.half.interval);
      assert.equal(frames[1].y + h + arrival.offsetY, 0);
      assert.equal(arrival.mediaTime, second.mediaOffset);
      assert.equal(model.splitPose(project, 1, 2).offsetY, 0);
    }
  }
  Object.assign(project.half, { layout:'rows', interval:0, borderColor:'#228866' });
  const chosen = { ...project.half };
  model.setMode(project, 'quad');
  const extra = project.cards[3];
  Object.assign(extra, { mediaPath:'/assets/extra.png', mediaType:'image' });
  project.quad.interval = 0.8;
  model.setMode(project, 'half');
  assert.deepEqual(project.half, chosen);
  assert.equal(project.cards[3], extra);
  assert.deepEqual(model.activeCards(project), [first, second]);
  const assets = media.collect({ presets:[{id:'p', name:'上下', project}] });
  assert.deepEqual(assets.map(asset => asset.mediaPath), [first.mediaPath, second.mediaPath]);
  const restored = model.upgrade(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored, project);
  assert.deepEqual(model.validate(restored), []);
  restored.half.layout = 'grid';
  assert.ok(model.validate(restored).some(message => message.includes('配置')));
  assert.throws(() => buildArgs(restored, '/tmp/sample.mov'), /配置/);
});

test('PNG and MOV drop into both halves with a clean seam, transparent entrance and optional divider', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-half-'));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const project = library.baseProject('half');
  Object.assign(project, { width:322, height:182, fps:20, duration:1.5 });
  Object.assign(project.half, { startAt:0.1, slideDuration:0.4, interval:0.4, borderWidth:0 });
  const red = [231, 49, 53], blue = [38, 79, 224], green = [48, 209, 97], gold = [237, 183, 48];

  function run(args) {
    return execFileSync(ffmpeg, ['-hide_banner','-v','error','-nostdin','-y', ...args], { maxBuffer:12 * 1024 * 1024 });
  }
  function makeImage(name, rgb) {
    const pixels = Buffer.alloc(48 * 54 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
    const filename = path.join(dir, name);
    fs.writeFileSync(filename, encodePNG({ width:48, height:54, pixels }));
    return filename;
  }
  async function renderFrames(name) {
    const outputPath = path.join(dir, name + '.mov');
    await render(project, { outputPath, ffmpegPath:ffmpeg });
    const bytes = run(['-i', outputPath, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-']);
    const { width, height, fps, duration } = project;
    assert.equal(bytes.length, width * height * 4 * fps * duration);
    return (time, x, y) => {
      const offset = ((Math.round(time * fps) * height + y) * width + x) * 4;
      return [...bytes.subarray(offset, offset + 4)];
    };
  }
  function assertColor(pixel, expected) {
    assert.ok(pixel[3] >= 248 && expected.every((v, i) => Math.abs(v - pixel[i]) < 14), [pixel, expected]);
  }

  try {
    Object.assign(project.cards[0], { mediaType:'image', mediaPath:makeImage('画像.png', red) });
    [blue, green, gold, gold].forEach((color, i) => makeImage('frame' + i + '.png', color));
    const video = path.join(dir, '動画.mov');
    run(['-framerate', '4', '-i', path.join(dir, 'frame%d.png'), '-c:v', 'qtrle', '-pix_fmt', 'argb', video]);
    Object.assign(project.cards[1], { mediaType:'video', mediaPath:video, mediaOffset:0.25 });

    for (const layout of ['columns','rows']) {
      project.half.layout = layout;
      const at = await renderFrames(layout);
      assert.equal(at(0, 20, 10)[3], 0);
      assertColor(at(0.25, 20, 10), red);
      assert.equal(at(0.25, 20, 178)[3], 0);
      assert.equal(at(0.25, 250, 165)[3], 0);
      assertColor(at(0.6, 240, 30), green);
      assertColor(at(1.3, 20, 10), red);
      assertColor(at(1.3, 240, 165), gold);
      if (layout === 'columns') {
        for (let y = 0; y < project.height; y++) {
          assertColor(at(1.3, 160, y), red);
          assertColor(at(1.3, 161, y), gold);
        }
      } else {
        for (let x = 0; x < project.width; x++) {
          assertColor(at(1.3, x, 90), red);
          assertColor(at(1.3, x, 91), gold);
        }
      }
    }
    Object.assign(project.half, { layout:'columns', interval:0, borderWidth:6, borderColor:'#ffffff' });
    Object.assign(project.cards[1], { mediaScale:50, mediaX:20 });
    const together = await renderFrames('同時');
    assertColor(together(0.3, 30, 65), red);
    assertColor(together(0.3, 260, 65), green);
    assertColor(together(1.3, 161, 90), [255, 255, 255]);
    assert.equal(together(1.3, 172, 90)[3], 0);
    assertColor(together(1.3, 260, 90), gold);
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});
