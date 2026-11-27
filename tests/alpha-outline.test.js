'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const highlight = require('../js/highlight');
const model = require('../js/model');
const { project, sprite } = require('./alpha-fixtures.cjs');
const renderer = require('../js/render');

function pixel(data, width, x, y) { return Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)); }
function band(p, minAlpha = 165) { return p[0] > 175 && p[1] > 175 && p[2] < 100 && p[3] > minAlpha; }
test('a crisp gold rim and short outer glow preserve opaque and translucent artwork', () => {
  const settings = project().highlight, image = sprite();
  const alpha = highlight.alphaPlane(image.pixels);
  const source = { ...image, alpha, rect: {x:0,y:0,width:96,height:64} };
  settings.layers = model.defaultHighlight({}).layers;
  function draw() {
    const r = highlight.raster(settings, 1, source);
    return (x,y) => pixel(r.pixels, r.width, x+r.padding, y+r.padding);
  }
  let at = draw();
  for (let y=0;y<64;y++) for (let x=0;x<96;x++) if (alpha[y*96+x]) assert.equal(at(x,y)[3],0);
  const rim = at(16,36), halo = at(10,36), tail = at(5,36);
  assert.ok(rim[3]>235 && rim[0]>245 && rim[1]>220 && rim[2]>115 && rim[2]<185);
  assert.ok(band(halo,100) && halo[3]<175);
  assert.ok(tail[3]>20 && tail[3]<60 && tail[3]<halo[3]);
  const wisp=at(20,9);
  assert.ok(wisp[3]>60 && wisp[3]<100, 'a 38% opaque strand has a proportionately soft rim');
  assert.equal(at(-5,36)[3],0);
  const fullEdge = at(15,36)[3];
  for (let y=13;y<53;y++) alpha[y*96+17]=96;
  at=draw();
  assert.ok(at(15,36)[3]<fullEdge, 'a partly covered boundary gives the falling edge a subpixel position');
  assert.equal(at(17,36)[3],0);
  // A deliberately inset layer still crosses the inside edge. The wide outer glow cannot tint it.
  settings.layers=[model.highlightLayer('外側','#ffff00',8,30,1,1),model.highlightLayer('内側','#ff0000',2,0,-2,1)];
  at=draw();assert.deepEqual(at(18,36),[255,0,0,255]);assert.equal(at(28,20)[3],0);
});
test('antialiased contour samples yield an even halo and overlapping lights share one material opacity', () => {
  const settings=project().highlight;
  settings.layers=model.defaultHighlight({}).layers;
  const width=96,height=64,alpha=new Uint8Array(width*height);
  for(let y=24;y<54;y++) for(let x=4;x<92;x++) {
    alpha[y*width+x]=y===24?24:(y===25?(x%10<5?68:236):255);
  }
  function draw() {
    const r=highlight.raster(settings,1,{alpha,width,height,rect:{x:0,y:0,width,height}});
    return (x,y)=>pixel(r.pixels,r.width,r.padding+x,r.padding+y)[3];
  }
  let at=draw();
  const alongEdge=Array.from({length:30},(_,i)=>at(30+i,18));
  assert.ok(Math.min(...alongEdge)>110 && Math.max(...alongEdge)-Math.min(...alongEdge)<15);
  for(let i=0;i<alpha.length;i++) if(alpha[i]) alpha[i]=80;
  at=draw();
  assert.ok(at(48,23)>=75 && at(48,23)<=80);
  assert.equal(at(48,24),0);
});
test('subject edges, holes, faint disconnected features and empty alpha use the same layered distance field', () => {
  const settings = project().highlight, image = sprite(), alpha = highlight.alphaPlane(image.pixels);
  const rect = { x: 0, y: 0, width: 96, height: 64 };
  const rendered = highlight.raster(settings, 1, { ...image, rect, alpha });
  const at = (x,y) => pixel(rendered.pixels, rendered.width, x + rendered.padding, y + rendered.padding);
  for (const [x,y] of [[16,35],[26,30]]) assert.ok(band(at(x,y)), [x,y]);
  for (const [x,y] of [[60,13],[20,9]]) assert.ok(band(at(x,y),75) && at(x,y)[3]<=96, [x,y]);
  for (const [x,y] of [[0,32],[10,2],[33,32],[85,55]]) assert.equal(at(x,y)[3], 0);
  assert.ok(at(13,35)[3] > 0 && at(13,35)[3] < at(16,35)[3]);
  const blank = highlight.raster(settings, 1, { ...image, rect, alpha: new Uint8Array(96*64) });
  assert.ok(blank.pixels.every(value => value === 0));
  assert.equal(highlight.alphaPlane(Uint8Array.from([20,50,70,255])), null);
  assert.ok(band(pixel(highlight.raster(settings, 1).pixels, rendered.width, rendered.padding, rendered.padding+32)));
});

test('export follows actual PNG and moving video alpha; fixed frames, opaque media and transparent intro/EOF remain correct', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'card-outline-test-'));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', p = project(), card = p.cards[0];
  function command(args) { return execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { maxBuffer: 32 * 1024 * 1024 }); }
  function save(name, image) { const file = path.join(work,name); fs.writeFileSync(file,highlight.encodePNG(image)); return file; }
  async function frames(name, signal) {
    const outputPath = path.join(work,name+'.mov');
    await renderer.render(p, { outputPath, ffmpegPath: ffmpeg, signal });
    const raw = command(['-i',outputPath,'-c:v','rawvideo','-pix_fmt','rgba','-f','rawvideo','-']);
    assert.equal(raw.length, 128*96*4*6);
    return (t,x,y) => pixel(raw.subarray(t*128*96*4),128,16+x,16+y);
  }
  try {
    card.mediaPath = save('cutout.png',sprite()); card.mediaType = 'image';
    delete p.highlight.followAlpha; // previously saved JSON, opened without a migration step
    let at = await frames('cutout');
    assert.ok(band(at(0,16,35))); assert.ok(band(at(0,26,30))); assert.ok(band(at(0,60,13),75));
    assert.equal(at(0,0,32)[3],0); assert.equal(at(0,33,32)[3],0);
    assert.ok(at(0,20,36)[2] > 155); assert.ok(Math.abs(at(0,63,13)[3]-96)<20);
    p.highlight.followAlpha=false;
    at = await frames('manual'); assert.ok(band(at(0,0,32))); assert.equal(at(0,16,35)[3],0);
    p.highlight.followAlpha=true; card.mediaX=8;card.mediaScale=50;
    at=await frames('placement'); assert.ok(band(at(0,39,34))); assert.equal(at(0,16,35)[3],0);
    const opaque=sprite(); for(let i=3;i<opaque.pixels.length;i+=4)opaque.pixels[i]=255;
    card.mediaPath=save('opaque-rgba.png',opaque);
    at=await frames('opaque');assert.ok(band(at(0,0,32)));assert.equal(at(0,30,35)[3],0);
    card.mediaPath=save('empty.png',sprite(0,true));card.mediaX=0;card.mediaScale=100;
    at=await frames('empty'); assert.equal(at(0,0,32)[3],0);assert.equal(at(0,16,35)[3],0);
    save('f00.png',sprite(0,true));save('f01.png',sprite());save('f02.png',sprite(18));
    const clip=path.join(work,'moving.mov');
    command(['-framerate','10','-i',path.join(work,'f%02d.png'),'-c:v','qtrle','-pix_fmt','argb',clip]);
    card.mediaType='video';card.mediaPath=clip;
    at=await frames('motion');assert.equal(at(0,0,32)[3],0);assert.equal(at(0,16,35)[3],0);
    assert.ok(band(at(1,16,35)));assert.ok(band(at(2,34,35)));assert.equal(at(2,16,35)[3],0);assert.ok(band(at(5,34,35)));
    card.mediaOffset=0.1;
    at=await frames('trimmed');assert.ok(band(at(0,16,35)));assert.ok(band(at(1,34,35)));
    const customLayers = p.highlight.layers;
    p.highlight.layers = model.defaultHighlight(p).layers;
    const glowing = await frames('glowing-video');
    p.highlight.layers = [];
    const clean = await frames('source-video');
    for (const [t,shift] of [[0,0],[1,18],[5,18]]) {
      for (const [x,y] of [[17,35],[48,35],[21,9],[61,13]]) {
        const a=glowing(t,x+shift,y), b=clean(t,x+shift,y);
        assert.ok(a.slice(0,3).every((v,i)=>Math.abs(v-b[i])<=9), [t,x,y,a,b]);
        assert.ok(Math.abs(a[3]-b[3])<=1, [t,x,y,a,b]);
      }
      const rim=glowing(t,16+shift,35),halo=glowing(t,10+shift,35);
      assert.ok(rim[3]>230 && rim[2]>115 && rim[2]<190);
      assert.ok(band(halo,100) && halo[3]<175);
      const wispRim=glowing(t,20+shift,9);
      assert.ok(wispRim[3]>60 && wispRim[3]<100);
      assert.equal(glowing(t,-5+shift,35)[3],0);
    }
    p.highlight.layers = customLayers;
    const webm=path.join(work,'motion.webm');
    command(['-framerate','10','-i',path.join(work,'f%02d.png'),'-c:v','libvpx-vp9','-lossless','1','-pix_fmt','yuva420p',webm]);
    card.mediaPath=webm;card.mediaOffset=0;at=await frames('webm');
    assert.equal(at(0,0,32)[3],0);assert.ok(band(at(1,16,35)));assert.ok(band(at(2,34,35)));
    assert.equal(at(2,16,35)[3],0);
    const corner=sprite();
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)corner.pixels.set([15,74,185,255],(y*96+x)*4);
    const originalLayers=p.highlight.layers;
    Object.assign(p.highlight,{shape:'rounded',radius:25,layers:[]});
    card.mediaType='image';card.mediaPath=save('edge.png',corner);
    at=await frames('source-corners');assert.ok(at(0,1,1)[2]>150 && at(0,1,1)[3]>250);
    save('mix0.png',opaque);save('mix1.png',corner);save('mix2.png',sprite(0,true));
    const mixed=path.join(work,'mixed.mov');
    command(['-framerate','10','-i',path.join(work,'mix%d.png'),'-c:v','qtrle','-pix_fmt','argb',mixed]);
    card.mediaType='video';card.mediaPath=mixed;at=await frames('mixed-output');
    assert.equal(at(0,1,1)[3],0);assert.ok(at(1,1,1)[3]>250);assert.equal(at(2,1,1)[3],0);
    p.highlight.layers=originalLayers;
    const outputPath=path.join(work,'cancel.mov'),controller=new AbortController();
    fs.writeFileSync(outputPath,'existing movie');p.duration=20;p.fps=60;
    const cancel=()=>controller.abort(),timeout=setTimeout(cancel,4000);
    try{
      await assert.rejects(renderer.render(p,{outputPath,ffmpegPath:ffmpeg,signal:controller.signal,onProgress:cancel}),err=>err.code==='CANCELLED');
    }finally{clearTimeout(timeout);}
    assert.equal(fs.readFileSync(outputPath,'utf8'),'existing movie');
    assert.ok(!fs.readdirSync(work).some(name=>name.startsWith('.cancel.mov.')));
  } finally { fs.rmSync(work,{recursive:true,force:true}); }
});
