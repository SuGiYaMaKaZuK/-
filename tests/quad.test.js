'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const model = require('../js/model'), library = require('../js/library'), media = require('../js/media-library');
const renderer = require('../js/render'), {encodePNG} = require('../js/highlight');

test('four-panel templates keep independent settings, reuse saved media, and tile both layouts', () => {
  const p=library.baseProject('quad');
  assert.equal(p.cards.length,4);assert.equal(p.quad.layout,'columns');assert.deepEqual(model.validate(p),[]);
  model.resizeCards(p,6);
  p.cards.forEach((c,i)=>Object.assign(c,{mediaPath:'/sample/'+i+'.png',mediaType:'image'}));
  const ids=p.cards.map(c=>c.id),three={...p.trapezoid};
  for(const [width,height] of [[322,182],[1080,1920]]) {
    Object.assign(p,{width,height});
    for(const layout of ['columns','grid']) for(const angle of [-20,0,20]) {
      Object.assign(p.quad,{layout,angle});
      const polys=model.splitPolygons(p), boxes=polys.map(model.splitBounds);
      const sizes=polys.map(poly=>(poly[1].x-poly[0].x+poly[2].x-poly[3].x)*(poly[3].y-poly[0].y)/2);
      assert.ok(sizes.every(a=>a>0));assert.ok(Math.abs(sizes.reduce((a,b)=>a+b)-width*height)<0.001);
      assert.deepEqual(polys[0][1],polys[1][0]);assert.deepEqual(polys[0][2],polys[1][3]);
      if(layout==='grid'){assert.deepEqual(polys[0][3],polys[2][0]);assert.equal(boxes[3].y,height/2);}
      const asset=library.placementFrom(p,p.cards[3].id);
      assert.deepEqual([asset.frameWidth,asset.frameHeight],[boxes[3].width,boxes[3].height]);
    }
  }
  const quad={...p.quad};
  model.setMode(p,'trapezoid');assert.deepEqual(p.trapezoid,three);assert.equal(model.activeCards(p).length,3);
  model.setMode(p,'quad');assert.deepEqual(p.quad,quad);assert.deepEqual(p.cards.map(c=>c.id),ids);
  assert.equal(model.activeCards(p).length,4);
  assert.equal(media.collect({presets:[{id:'saved',name:'4分割',project:p}]}).length,4);
  assert.deepEqual(model.upgrade(JSON.parse(JSON.stringify(p))),p);
  p.quad.layout='other';assert.ok(model.validate(p).some(e=>e.includes('配置')));
  p.quad.layout='grid';p.duration=1;assert.ok(model.validate(p).some(e=>e.includes('登場し終わる')));
});

test('four staggered panels export actual images and video, transparent motion, and clean final seams', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'card-quad-test-')), ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg';
  const p=library.baseProject('quad');
  Object.assign(p,{width:322,height:182,fps:20,duration:1.7});
  Object.assign(p.quad,{slideDuration:.4,startAt:.2,interval:.2,borderWidth:0});
  const red=[235,35,45],green=[35,220,70],blue=[45,75,230],pink=[235,45,205],gold=[238,185,35];
  function png(name,rgb){
    const pixels=Buffer.alloc(48*54*4);for(let i=0;i<pixels.length;i+=4)pixels.set([...rgb,255],i);
    const file=path.join(dir,name);fs.writeFileSync(file,encodePNG({width:48,height:54,pixels}));return file;
  }
  function run(args){return execFileSync(ffmpeg,['-hide_banner','-v','error','-nostdin','-y',...args],{maxBuffer:24*1024*1024});}
  async function render(name) {
    const movie=path.join(dir,name+'.mov');await renderer.render(p,{outputPath:movie,ffmpegPath:ffmpeg});
    const bytes=run(['-i',movie,'-pix_fmt','rgba','-f','rawvideo','-']);assert.equal(bytes.length,34*p.width*p.height*4);
    return (t,x,y)=>{const i=((Math.round(t*p.fps)*p.height+y)*p.width+x)*4;return [...bytes.subarray(i,i+4)];};
  }
  function color(pixel,rgb){assert.ok(pixel[3]>=248 && rgb.every((v,i)=>Math.abs(pixel[i]-v)<14),[pixel,rgb]);}
  try {
    [red,green,blue].forEach((rgb,i)=>Object.assign(p.cards[i],{mediaType:'image',mediaPath:png('素材'+i+'.png',rgb)}));
    [blue,pink,gold,gold].forEach((rgb,i)=>png('v'+i+'.png',rgb));
    const video=path.join(dir,'動画4.mov');run(['-framerate','5','-i',path.join(dir,'v%d.png'),'-c:v','qtrle','-pix_fmt','argb',video]);
    Object.assign(p.cards[3],{mediaPath:video,mediaType:'video',mediaOffset:.2});
    for(const layout of ['columns','grid']) {
      p.quad.layout=layout;
      const at=await render(layout);
      assert.equal(at(0,30,15)[3],0);color(at(.3,30,15),red);assert.equal(at(.3,30,150)[3],0);assert.equal(at(.3,250,10)[3],0);
      color(at(.9,285,layout==='grid'?40:15),pink);
      const centers=layout==='grid'?[[80,44],[239,44],[80,137],[239,137]]:[[40,90],[120,90],[200,90],[281,90]];
      centers.forEach(([x,y],i)=>color(at(1.6,x,y),[red,green,blue,gold][i]));
      for(const y of [0,90,91,181])for(let x=0;x<p.width;x++)assert.ok(at(1.6,x,y)[3]>248,[layout,x,y]);
    }
    Object.assign(p.quad,{layout:'columns',angle:10});
    const tilted=await render('tilted');
    color(tilted(1.6,70,6),red);color(tilted(1.6,70,175),green);
    color(tilted(1.6,230,6),blue);color(tilted(1.6,230,175),gold);
    Object.assign(p.quad,{layout:'grid',interval:0,borderWidth:6,borderColor:'#ffffff'});
    p.cards[3].mediaScale=50;p.cards[3].mediaX=18;
    const transformed=await render('同時');
    color(transformed(.8,161,135),[255,255,255]);color(transformed(.8,70,91),[255,255,255]);
    assert.equal(transformed(1.5,175,135)[3],0);color(transformed(1.5,260,135),gold);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
