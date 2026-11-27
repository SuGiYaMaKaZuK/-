'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const model = require('../js/model');
const { buildArgs, render } = require('../js/render');
const { encodePNG } = require('../js/highlight');

test('old halves start at full brightness and cues reverse a fade from its current brightness', () => {
  const project = model.createProject('half');
  delete project.half.dimming;
  assert.deepEqual(model.validate(project), []);
  assert.ok(!buildArgs(project, '/tmp/old-halves.mov').join(' ').includes('rgb24'));
  model.upgrade(project);
  const [left, right] = project.half.dimming;
  assert.notEqual(left.cues, right.cues);
  assert.equal(model.dimGain(model.dimCurve(right), 100), 1);
  Object.assign(left, { amount:80, fade:1, cues:[
    {time:1,dark:true}, {time:1.25,dark:true}, {time:1.5,dark:false}
  ] });
  const curve = model.dimCurve(left);
  for (const [time, gain] of [[0,1],[1,1],[1.25,0.8],[1.5,0.6],[2,0.8],[2.5,1]]) {
    assert.ok(Math.abs(model.dimGain(curve, time) - gain) < 1e-8, [time, gain]);
  }
  left.fade = 0;
  assert.ok(model.dimGain(model.dimCurve(left), 1) < 0.201);
  assert.equal(model.dimGain(model.dimCurve(left), 1.5), 1);
  const before = JSON.stringify(project.half.dimming);
  model.setMode(project, 'quad');
  assert.ok(!buildArgs(project, '/tmp/four.mov').includes('rgb24'));
  model.setMode(project, 'half');
  project.half.layout = 'rows';
  assert.equal(JSON.stringify(project.half.dimming), before);
  assert.deepEqual(model.upgrade(JSON.parse(JSON.stringify(project))), project);
  for (const bad of [{amount:101},{initial:1},{fade:-1},{cues:[{time:1,dark:true},{time:1,dark:false}]},{cues:[{time:0.3,dark:'yes'}]}]) {
    const draft = JSON.parse(JSON.stringify(project));
    Object.assign(draft.half.dimming[1], bad);
    assert.ok(model.validate(draft).some(message => message.includes('暗転')));
    assert.throws(() => buildArgs(draft, '/tmp/bad.mov'), /暗転/);
  }
});

test('static and timed dimming preserves image/video alpha, colors on the other side and the divider in both layouts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-dimming-test-'));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const project = model.createProject('half');
  Object.assign(project, { width:128, height:128, fps:10, duration:2 });
  Object.assign(project.half, { slideDuration:0.1, interval:0, borderWidth:4, borderColor:'#ffffff' });
  function run(args) {
    return execFileSync(ffmpeg, ['-loglevel','error','-y','-nostdin',...args], { maxBuffer:5 * 1024 * 1024 });
  }
  function png(width, height, name, rgb) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const alpha = x < width / 4 ? 255 : x < width / 2 ? 128 : x < 3 * width / 4 ? 0 : 255;
      pixels.set([...rgb, alpha], (y * width + x) * 4);
    }
    const file = path.join(dir, name);
    fs.writeFileSync(file, encodePNG({width, height, pixels}));
    return file;
  }
  async function frames(name, direct) {
    const file = path.join(dir, name + '.mov');
    if (direct) run(buildArgs(project, file));
    else await render(project, {ffmpegPath:ffmpeg, outputPath:file});
    const bytes = run(['-i',file,'-pix_fmt','rgba','-f','rawvideo','-']);
    assert.equal(bytes.length, 20 * 128 * 128 * 4);
    return (time, x, y) => {
      const offset = ((Math.round(time * 10) * 128 + y) * 128 + x) * 4;
      return [...bytes.subarray(offset, offset + 4)];
    };
  }
  function compare(actual, normal, gain) {
    assert.equal(actual[3], normal[3]);
    if (normal[3]) for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(actual[c] - normal[c] * gain) < 6, JSON.stringify({ actual, normal, gain }));
    }
  }
  try {
    for (const layout of ['columns','rows']) {
      const rows = layout === 'rows', w = rows ? 128 : 64, h = rows ? 64 : 128;
      project.half.layout = layout;
      const image = png(w, h, '絵.png', [219,111,57]);
      const video = path.join(dir, '映像.mov');
      [[52,143,229],[97,177,211],[119,161,205],[78,144,183]].forEach((rgb,i) => png(w,h,'frame'+i+'.png',rgb));
      run(['-framerate','2','-i',path.join(dir,'frame%d.png'),'-c:v','qtrle','-pix_fmt','argb',video]);
      Object.assign(project.cards[0], { mediaPath:image, mediaType:'image' });
      Object.assign(project.cards[1], { mediaPath:video, mediaType:'video' });
      delete project.half.dimming;
      const normal = await frames(layout + '-baseline');
      model.upgrade(project);
      const [left, right] = project.half.dimming;
      Object.assign(left, {initial:true, amount:60, fade:0.2, cues:[{time:1,dark:false}]});
      Object.assign(right, {amount:100, fade:0.2, cues:[{time:0.8,dark:true},{time:1.4,dark:false}]});
      const dimmed = await frames(layout + '-dimming');
      for (const [time, a, b] of [[0.5,0.4,1],[0.9,0.4,0.5],[1.1,0.7,0],[1.2,1,0],[1.5,1,0.5],[1.8,1,1]]) {
        for (const [index, gain] of [a,b].entries()) {
          for (const part of [1,3,5,7]) {
            const x = (rows ? 0 : w * index) + w * part / 8;
            const y = (rows ? h * index : 0) + h / 2;
            const sourceAlpha = [255,128,0,255][(part-1)/2];
            assert.ok(Math.abs(normal(time,x,y)[3] - sourceAlpha) <= 1);
            compare(dimmed(time,x,y), normal(time,x,y), gain);
          }
        }
        const x = rows ? 13 : 64, y = rows ? 64 : 30;
        const seam = normal(time,x,y);
        assert.ok(seam.slice(0,3).every(v => v > 245));
        compare(dimmed(time,x,y), seam, 1);
      }
      if (rows) {
        const direct = await frames('direct-args', true);
        compare(direct(1.1,14,32), normal(1.1,14,32), 0.7);
        left.cues = []; left.amount = 100; right.cues = [];
        const fixed = await frames('full-black');
        compare(fixed(0.8,16,32), normal(0.8,16,32), 0);
        compare(fixed(0.8,48,32), normal(0.8,48,32), 0);
        compare(fixed(0.8,80,32), normal(0.8,80,32), 0);
        compare(fixed(0.8,16,96), normal(0.8,16,96), 1);
      }
    }
  } finally {
    fs.rmSync(dir, {recursive:true, force:true});
  }
});
