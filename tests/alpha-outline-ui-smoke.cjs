'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const { project, sprite } = require('./alpha-fixtures.cjs');
const highlight = require('../js/highlight');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const base = 'http://127.0.0.1:8177';
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-alpha-browser-'));
  let browser;
  try {
    for (const [n, image] of [sprite(0, true), sprite(), sprite(18)].entries()) {
      fs.writeFileSync(path.join(temp,'f'+n+'.png'),highlight.encodePNG(image));
    }
    execFileSync('ffmpeg',['-v','error','-framerate','5','-i',path.join(temp,'f%d.png'),'-c:v','libvpx-vp9','-lossless','1','-pix_fmt','yuva420p',path.join(temp,'motion.webm')]);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox'] });
    const page = await browser.newPage({ viewport: {width:1120,height:800} }); const errors=[];
    page.on('pageerror',err => errors.push(err.message));
    await page.route(base+'/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const f = /^\/(?:f[012]\.png|motion\.webm)$/.test(pathname) ? path.join(temp,pathname.slice(1)) : path.resolve(root,'.'+pathname);
      if (!f.startsWith(root+path.sep) && !f.startsWith(temp+path.sep)) return route.abort();
      if(pathname==='/motion.webm'){
        const data=fs.readFileSync(f),range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
        const headers={'content-type':'video/webm','accept-ranges':'bytes'};
        if(range){
          const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;
          if(start>end)return route.fulfill({status:416,headers:{'content-range':'bytes */'+data.length}});
          headers['content-range']='bytes '+start+'-'+end+'/'+data.length;
          return route.fulfill({status:206,headers,body:data.subarray(start,end+1)});
        }
        return route.fulfill({headers,body:data});
      }
      return route.fulfill({path:f});
    });
    await page.goto(base+'/index.html');
    const p=project(); p.cards.forEach(c => { c.x=64;c.y=48; }); p.cards[0].mediaPath=base+'/f1.png';p.cards[0].mediaType='image';delete p.highlight.followAlpha;
    async function open(p) {
      await page.evaluate(state=>CardPanel.setProject(state),p);
      await page.waitForFunction(()=>!CardPanel.isMediaPending());
    }
    async function color(x,y) {
      return page.evaluate(([x,y])=>Array.from(document.getElementById('preview').getContext('2d').getImageData(x+16,y+16,1,1).data),[x,y]);
    }
    const yellow = (rgba,minAlpha=155) => rgba[0]>150 && rgba[1]>150 && rgba[2]<100 && rgba[3]>minAlpha;
    await open(p);
    const follow=page.locator('#highlight-follow-alpha');
    assert.ok(await follow.isChecked());
    assert.ok(yellow(await color(16,35)));assert.ok(yellow(await color(26,32)));assert.ok(yellow(await color(60,13),75));
    assert.equal((await color(0,32))[3],0);assert.equal((await color(33,32))[3],0);
    await follow.uncheck();assert.ok(yellow(await color(0,32)));assert.equal((await color(16,35))[3],0);
    const existing=await page.evaluate(()=>CardPanel.getProject());
    await page.getByRole('button',{name:'光る縁取り',exact:true}).click();
    assert.ok(await follow.isChecked());
    const glowing=await page.evaluate(()=>CardPanel.getProject());
    assert.deepEqual(glowing.cards,existing.cards);assert.notDeepEqual(glowing.highlight.layers,existing.highlight.layers);
    assert.equal(await page.locator('#layer-name').inputValue(),'外側の光');
    const rim=await color(16,35), halo=await color(10,35);
    assert.ok(rim[2]>115 && rim[2]<185 && rim[3]>235);
    assert.ok(yellow(halo,100) && halo[3]<175);assert.equal((await color(-5,35))[3],0);
    const glowingBody=await color(17,35), glowingHair=await color(21,9);
    const clean=JSON.parse(JSON.stringify(glowing));clean.highlight.layers=[];
    await page.locator('#undo-edit').click();
    assert.deepEqual(await page.evaluate(()=>CardPanel.getProject()),existing);
    await page.locator('#redo-edit').click();
    assert.deepEqual(await page.evaluate(()=>CardPanel.getProject()),glowing);
    await page.locator('[data-layer-select]').first().click();
    await page.locator('#layer-opacity').fill('25');await page.locator('#layer-opacity').press('Tab');
    assert.ok((await color(10,35))[3]<halo[3]-35);assert.ok((await color(16,35))[3]>230);
    await open(clean);assert.deepEqual(await color(17,35),glowingBody);assert.deepEqual(await color(21,9),glowingHair);
    await open(existing);
    await follow.check();assert.ok(yellow(await color(16,35)));assert.equal((await color(0,32))[3],0);
    const toggleProject=await page.evaluate(()=>CardPanel.getProject());assert.equal(toggleProject.highlight.followAlpha,true);
    p.cards[0].mediaPath=base+'/f0.png';await open(p);assert.equal((await color(0,32))[3],0);assert.equal((await color(16,35))[3],0);
    p.cards[0].mediaType='video';p.cards[0].mediaPath=base+'/motion.webm';await open(p);
    assert.equal((await color(0,32))[3],0);
    async function seek(time,x){
      await page.locator('#scrub').evaluate((slider,time)=>{slider.value=time;slider.dispatchEvent(new Event('input'));},time);
      await page.waitForFunction(x=>{const c=document.getElementById('preview').getContext('2d').getImageData(x+16,51,1,1).data;return c[0]>150 && c[1]>150 && c[3]>155;},x);
    }
    await seek(.25,16);await seek(.45,34);assert.equal((await color(16,35))[3],0);
    const nativeWindow={__adobe_cep__:{getSystemPath:()=>root,evalScript(){}},cep_node:{require}};
    vm.runInNewContext(fs.readFileSync(path.join(root,'js/bridge.js'),'utf8'),{window:nativeWindow,require,AbortController,console});
    let nativeReads=0;
    await page.exposeFunction('readLocalAlpha', async (url,size,time)=>{
      nativeReads++;
      const file=path.join(temp,path.basename(new URL(url).pathname));
      return (await nativeWindow.CardBridge.previewAlpha(file,size,time)).toString('base64');
    });
    await page.evaluate(()=>{
      const read=CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData=function(...args){
        if(!this.canvas.isConnected)throw new DOMException('Local file canvas','SecurityError');
        return read.apply(this,args);
      };
      CardBridge.previewAlpha=async (...args)=>Uint8Array.from(atob(await readLocalAlpha(...args.slice(0,3))),c=>c.charCodeAt(0));
    });
    p.cards[0].mediaType='image';p.cards[0].mediaPath=base+'/f1.png';await open(p);
    await seek(0,16);assert.equal((await color(0,32))[3],0);
    p.cards[0].mediaType='video';p.cards[0].mediaPath=base+'/motion.webm';await open(p);
    await seek(.25,16);await seek(.45,34);assert.equal((await color(16,35))[3],0);
    assert.ok(nativeReads >= 3);
    assert.deepEqual(errors,[]);console.log('PNG and animated alpha WebM contours passed in the editor, including inner holes, disconnected translucent pixels, manual frame override, fully transparent frames and seeking.');
  } finally { if(browser)await browser.close();fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(err=>{console.error(err);process.exitCode=1;});
