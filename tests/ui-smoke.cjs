/* Optional browser check: node tests/ui-smoke.cjs.
   Requires Playwright + Chromium; the Premiere extension itself has no npm dependencies. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'card-reveal-ui-'));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((request,response)=>{
  const raw=request.url.split('?')[0],filename=path.resolve(root,'.'+decodeURIComponent(raw==='/'?'/index.html':raw));
  if(!filename.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  fs.readFile(filename,(error,body)=>{if(error){response.writeHead(404).end();return;}response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');response.end(body);});
});
// A red/blue PNG with known pixels verifies actual preview movement, not just field values.
function fixturePNG(){
  const zlib=require('node:zlib'),width=64,height=64;
  function crc(buffer){let value=0xffffffff;for(const byte of buffer){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
  function chunk(type,bytes){const kind=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([kind,bytes])));return Buffer.concat([length,kind,bytes,checksum]);}
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(1+width*4)+1+x*4;rows[i]=x<32?240:20;rows[i+1]=20;rows[i+2]=x<32?20:240;rows[i+3]=255;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
let browser;
async function openSavedPresets(target){const disclosure=target.locator('#saved-presets');if(await disclosure.count() && !await disclosure.evaluate(el=>el.open))await disclosure.locator('summary').click();}
async function resetScroll(target){await target.evaluate(()=>{scrollTo(0,0);document.querySelectorAll('*').forEach(el=>{if(el.scrollHeight>el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))el.scrollTop=0;});});}
async function capture(target,name){if(process.env.UI_SCREENSHOTS!=='0')await target.screenshot({path:path.join(root,'examples',name),fullPage:true});}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(url);
  await openSavedPresets(page);
  const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(CardPanel.getProject())));
  const setTime=time=>page.locator('#scrub').evaluate((el,time)=>{el.value=String(time);el.dispatchEvent(new Event('input',{bubbles:true}));},time);
  const fill=async(selector,value)=>{await page.locator(selector).fill(String(value));await page.locator(selector).blur();};
  const pixel=(x,y)=>page.evaluate(({x,y})=>{const c=document.getElementById('preview'),p=CardPanel.getProject();return Array.from(c.getContext('2d').getImageData(Math.round(x*c.width/p.width),Math.round(y*c.height/p.height),1,1).data);},{x,y});
  const uploadFixture=async index=>{await page.locator('[data-media]').nth(index).click();await page.locator('#media-input').setInputFiles({name:'position-test.png',mimeType:'image/png',buffer:fixturePNG()});await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-thumb] img')).every(img=>img.complete && img.naturalWidth>0));};
  assert.equal(await page.locator('.card-row').count(),3);assert.equal(await page.locator('#render').isDisabled(),true);
  assert.equal(await page.locator('[data-setting="width"]').isVisible(),false);
  assert.equal(await page.locator('[data-field="x"]').isVisible(),false);
  assert.equal(await page.locator('[data-field="flipAt"]').isVisible(),true);
  assert.match(await page.locator('#missing-media-warning').textContent(),/単色/);
  await page.locator('#sample-project').click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-thumb] img')).length===3 && Array.from(document.querySelectorAll('[data-thumb] img')).every(img=>img.complete && img.naturalWidth>0));
  await setTime(4);
  assert.equal(await page.locator('#missing-media-warning').isVisible(),false);
  assert.equal(await page.locator('#media-scale-slider').isVisible(),true);
  assert.equal(await page.locator('#media-x').isVisible(),true);
  await uploadFixture(0);await setTime(4);const frame=(await state()).cards[0];
  assert.deepEqual(await pixel(frame.x-80,frame.y-180),[240,20,20,255]);
  await page.locator('#media-scale').fill('50');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'media-scale');
  assert.equal((await state()).cards[0].mediaScale,50);assert.equal(await page.locator('#media-scale-slider').inputValue(),'50');
  assert.deepEqual(await pixel(frame.x-80,frame.y-180),[37,27,77,255]);
  await page.locator('#media-x').fill('80');await page.locator('#media-y').fill('40');
  assert.deepEqual(await pixel(frame.x-80,frame.y),[37,27,77,255]);
  assert.equal((await state()).cards[0].x,frame.x);assert.equal((await state()).cards[0].y,frame.y);
  await page.locator('.card-row').nth(1).click();assert.equal(await page.locator('#media-scale').inputValue(),'100');
  await fill('#media-scale',125);await fill('#media-x',-20);await fill('#media-y',15);
  await page.locator('.card-row').first().click();assert.equal(await page.locator('#media-scale').inputValue(),'50');assert.equal(await page.locator('#media-x').inputValue(),'80');
  await uploadFixture(0);assert.equal((await state()).cards[0].mediaScale,50);assert.equal((await state()).cards[0].mediaX,80);
  await page.locator('#media-scale-slider').evaluate(el=>{el.value='175';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#media-scale').inputValue(),'175');
  await page.locator('#reset-media').click();assert.deepEqual([(await state()).cards[0].mediaScale,(await state()).cards[0].mediaX,(await state()).cards[0].mediaY],[100,0,0]);assert.equal((await state()).cards[1].mediaScale,125);
  await fill('#media-scale',137);await fill('#media-x',25);await fill('#media-y',-12);
  let before=await state();await fill('#card-count',12);let after=await state();
  assert.equal(after.cards.length,12);assert.equal(after.cards[0].x,before.cards[0].x);assert.equal(after.cards[0].y,before.cards[0].y);assert.equal(after.cardWidth,before.cardWidth);
  await page.locator('[data-move="0"][data-direction="1"]').click();after=await state();assert.equal(after.cards[1].id,before.cards[0].id);
  await page.locator('[data-layout="grid"]').click();after=await state();assert.ok(new Set(after.cards.map(c=>c.y)).size>1);
  await fill('#card-count',3);await page.locator('[data-layout="row"]').click();after=await state();assert.ok(after.cards[0].x<after.cards[1].x && after.cards[1].x<after.cards[2].x);
  const firstPosition={x:after.cards[0].x,y:after.cards[0].y};await page.locator('.card-row').nth(1).click();await page.locator('[data-layout="center"]').click();after=await state();assert.equal(after.cards[1].x,after.width/2);assert.equal(after.cards[0].x,firstPosition.x);
  await page.locator('.card-row').first().click();await setTime(4);await page.locator('#flip-now').click();assert.equal((await state()).cards[0].flipAt,4);
  await fill('#sequence-interval',.5);await page.locator('#sequence-cards').click();assert.deepEqual((await state()).cards.map(c=>c.flipAt),[4,4.5,5]);
  await page.locator('#card-details summary').click();assert.equal(await page.locator('[data-field="x"]').isVisible(),true);
  await setTime(6);await page.locator('#preview').scrollIntoViewIfNeeded();
  const c=(await state()).cards[0],bounds=await page.locator('#preview').boundingBox(),position={x:bounds.x+c.x/1920*bounds.width,y:bounds.y+c.y/1080*bounds.height};
  await page.mouse.move(position.x,position.y);await page.mouse.down();await page.mouse.move(position.x+35,position.y+20);await page.mouse.up();after=await state();assert.ok(after.cards[0].x>c.x && after.cards[0].y>c.y);
  const downloadPromise=page.waitForEvent('download');await page.locator('#save-project').click();const download=await downloadPromise,jsonPath=path.join(scratch,'settings.json');await download.saveAs(jsonPath);
  await page.locator('#load-project').click();await page.locator('#project-input').setInputFiles(jsonPath);await page.waitForFunction(x=>CardPanel.getProject().cards[0].x===x,after.cards[0].x);assert.deepEqual([(await state()).cards[0].mediaScale,(await state()).cards[0].mediaX,(await state()).cards[0].mediaY],[after.cards[0].mediaScale,after.cards[0].mediaX,after.cards[0].mediaY]);
  const presetMedia=(await state()).cards[0];
  await page.locator('#preset-name').fill('ボス紹介');await page.locator('#save-preset').click();await setTime(3);await page.locator('#flip-now').click();await fill('#media-scale',200);await page.locator('#load-preset').click();assert.equal((await state()).cards[0].flipAt,4);assert.equal((await state()).cards[0].mediaScale,presetMedia.mediaScale);
  await page.locator('#delete-preset').click();assert.equal(await page.locator('#preset-list option').count(),1);
  await page.locator('#mode-trapezoid').click();assert.equal((await state()).mode,'trapezoid');assert.equal(await page.locator('#card-count').isVisible(),false);assert.equal(await page.locator('#flip-now').isVisible(),false);assert.equal(await page.locator('.card-row').count(),3);
  await page.locator('#sample-project').click();await setTime(4);assert.equal((await state()).mode,'trapezoid');
  assert.equal(await page.locator('#media-scale').isVisible(),true);await uploadFixture(0);await setTime(4);
  assert.equal((await pixel(50,100))[3],255);await page.locator('#media-scale').fill('50');assert.equal((await pixel(50,100))[3],0);
  await fill('#media-x',80);await fill('#media-y',-30);assert.equal((await state()).cards[0].mediaX,80);
  await page.locator('#background-mode').selectOption('solid');assert.deepEqual(await pixel(50,100),[16,19,28,255]);
  await page.locator('.card-row').nth(1).click();assert.equal(await page.locator('#media-scale').inputValue(),'100');await page.locator('.card-row').first().click();assert.equal(await page.locator('#media-y').inputValue(),'-30');
  await page.locator('#reset-media').click();assert.equal((await state()).cards[0].mediaScale,100);

  await page.locator('#background-mode').selectOption('solid');await setTime(0);assert.equal(await page.evaluate(()=>document.getElementById('preview').getContext('2d').getImageData(0,0,1,1).data[3]),255);
  await page.locator('#background-mode').selectOption('transparent');assert.equal(await page.evaluate(()=>document.getElementById('preview').getContext('2d').getImageData(0,0,1,1).data[3]),0);
  await fill('[data-split-setting="angle"]',12);await fill('[data-split-setting="interval"]',.4);await fill('[data-split-setting="slideDuration"]',1);
  await page.locator('#advanced-settings summary').click();await page.locator('[data-setting="fps"]').selectOption('120');assert.equal((await state()).fps,120);await page.locator('[data-setting="fps"]').selectOption('90');assert.equal((await state()).fps,90);
  assert.deepEqual(await page.evaluate(()=>CardModel.validate(CardPanel.getProject())),[]);
  await page.locator('#advanced-settings summary').click();await setTime(4);await page.locator('#preview').scrollIntoViewIfNeeded();
  const splitBounds=await page.locator('#preview').boundingBox();await page.mouse.click(splitBounds.x+splitBounds.width*.9,splitBounds.y+splitBounds.height*.5);assert.match(await page.locator('#selected-name').textContent(),/右のパネル/);
  await page.locator('#preset-name').fill('台形3分割');await page.locator('#save-preset').click();await page.locator('#mode-cards').click();await page.locator('#load-preset').click();assert.equal((await state()).mode,'trapezoid');
  await page.locator('#sample-project').click();await page.locator('#card-details').evaluate(el=>el.open=false);await setTime(4);await fill('#media-scale',110);await fill('#media-x',20);await page.waitForTimeout(100);await resetScroll(page);await capture(page,'panel-split.png');
  await page.setViewportSize({width:420,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture(page,'panel-narrow.png');
  await page.setViewportSize({width:1440,height:1000});await page.locator('#mode-cards').click();await setTime(4);await resetScroll(page);await capture(page,'panel.png');await page.setViewportSize({width:420,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture(page,'panel-cards-narrow.png');
  await page.evaluate(()=>{var p=CardPanel.getProject();p.cards[0].name='x" onclick="window.injected=true';CardPanel.setProject(p);});assert.equal(await page.locator('.card-name').first().getAttribute('onclick'),null);
  await page.evaluate(()=>{var p=CardPanel.getProject();p.cards.forEach(c=>{delete c.mediaScale;delete c.mediaX;delete c.mediaY;});CardPanel.setProject(p);});assert.equal(await page.locator('#media-scale').inputValue(),'100');assert.equal(await page.locator('#media-x').inputValue(),'0');assert.equal(await page.locator('#media-y').inputValue(),'0');
  await page.setViewportSize({width:1440,height:1000});
  const extraBefore=(await state()).cards.map(c=>c.id);await page.locator('#mode-highlight').click();
  assert.equal((await state()).mode,'highlight');assert.equal(await page.locator('.card-row').count(),1);assert.deepEqual((await state()).cards.map(c=>c.id),extraBefore);
  assert.equal(await page.locator('[data-field="flipAt"]').count(),0);assert.equal(await page.locator('#card-count').isVisible(),false);assert.equal(await page.locator('#media-scale').isVisible(),true);
  await uploadFixture(0);await page.locator('#reset-media').click();await page.locator('#highlight-shape').selectOption('rectangle');await fill('[data-highlight-setting="width"]',400);await fill('[data-highlight-setting="height"]',300);await fill('[data-highlight-setting="rotation"]',0);await setTime(1);
  let h=(await state()).highlight;
  const centerPixel=await pixel(h.x+60,h.y);assert.ok(centerPixel[2]>230 && centerPixel[0]<30,'center remains image, with no internal emphasis');
  assert.ok((await pixel(h.x+h.width/2+25,h.y))[3]>20,'glow extends outside image perimeter');
  while(await page.locator('[data-layer-delete]').count())await page.locator('[data-layer-delete="0"]').click();
  assert.equal((await pixel(h.x+h.width/2+25,h.y))[3],0);assert.equal(await page.locator('#layer-width').isDisabled(),true);
  await page.locator('#add-layer').click();await fill('#layer-width',10);await fill('#layer-glow',0);await fill('#layer-offset',5);await page.locator('#layer-color').fill('#ff0000');await page.locator('#layer-color').blur();
  const redID=(await state()).highlight.layers[0].id;let border=await pixel(h.x+h.width/2+5,h.y);assert.ok(border[0]>240 && border[2]<15);
  await page.locator('#add-layer').click();await fill('#layer-width',10);await fill('#layer-glow',0);await fill('#layer-offset',5);await page.locator('#layer-color').fill('#0000ff');await page.locator('#layer-color').blur();border=await pixel(h.x+h.width/2+5,h.y);assert.ok(border[2]>240 && border[0]<15);
  await page.locator('[data-layer-move="1"][data-direction="-1"]').click();border=await pixel(h.x+h.width/2+5,h.y);assert.ok(border[0]>240 && border[2]<15);
  await page.locator('[data-layer-enabled="'+redID+'"]').uncheck();border=await pixel(h.x+h.width/2+5,h.y);assert.ok(border[2]>240 && border[0]<15);await fill('#layer-opacity',42);assert.equal((await state()).highlight.layers.find(l=>l.id===redID).opacity,.42);
  await page.locator('#reset-layers').click();assert.equal((await state()).highlight.layers.length,3);assert.equal((await state()).highlight.layers[0].color,'#ffe600');
  await page.evaluate(()=>{window.rasterCalls=0;var original=CardHighlight.raster;CardHighlight.raster=function(){window.rasterCalls++;return original.apply(this,arguments);};});
  await fill('[data-highlight-setting="x"]',950);await fill('[data-highlight-setting="rotation"]',30);await fill('#media-scale',110);assert.equal(await page.evaluate(()=>window.rasterCalls),0,'transform/media updates reuse border bitmap');
  await page.locator('#preview').scrollIntoViewIfNeeded();h=(await state()).highlight;const sourcePosition={x:(await state()).cards[0].x,y:(await state()).cards[0].y};let hb=await page.locator('#preview').boundingBox(),hp={x:hb.x+h.x/1920*hb.width,y:hb.y+h.y/1080*hb.height};await page.mouse.move(hp.x,hp.y);await page.mouse.down();await page.mouse.move(hp.x+30,hp.y+20);await page.mouse.up();assert.ok((await state()).highlight.x>h.x);assert.equal((await state()).cards[0].x,sourcePosition.x);assert.equal((await state()).cards[0].y,sourcePosition.y);
  await page.locator('#highlight-shape').selectOption('polygon');await page.locator('#edit-polygon').click();await page.locator('#add-point').click();assert.equal((await state()).highlight.points.length,5);await page.locator('#selected-point').selectOption('0');
  await page.locator('#preview').scrollIntoViewIfNeeded();h=(await state()).highlight;hb=await page.locator('#preview').boundingBox();
  function screenVertex(h,p,b){const r=h.rotation*Math.PI/180,dx=(p.x-.5)*h.width,dy=(p.y-.5)*h.height;return{x:b.x+(h.x+dx*Math.cos(r)-dy*Math.sin(r))/1920*b.width,y:b.y+(h.y+dx*Math.sin(r)+dy*Math.cos(r))/1080*b.height};}
  let start=screenVertex(h,h.points[0],hb),end=screenVertex(h,{x:.1,y:.08},hb);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y);await page.mouse.up();h=(await state()).highlight;assert.ok(Math.abs(h.points[0].x-.1)<.015 && Math.abs(h.points[0].y-.08)<.015,'rotated vertex drag uses inverse coordinates');
  await page.locator('#selected-point').selectOption('1');const validPoint={...h.points[1]};start=screenVertex(h,h.points[1],hb);end=screenVertex(h,{x:0,y:.5},hb);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y);await page.mouse.up();assert.deepEqual((await state()).highlight.points[1],validPoint,'dragging a vertex clearly across a nonadjacent edge is rejected');assert.match(await page.locator('#status-text').textContent(),/交差/);
  await page.locator('#remove-point').click();assert.equal((await state()).highlight.points.length,4);await page.locator('#remove-point').click();assert.equal((await state()).highlight.points.length,3);assert.equal(await page.locator('#remove-point').isDisabled(),true);
  await page.locator('#preset-name').fill('光る外周');await page.locator('#save-preset').click();const savedHighlight=(await state()).highlight;await fill('[data-highlight-setting="rotation"]',0);await page.locator('#load-preset').click();assert.deepEqual((await state()).highlight,savedHighlight);
  const highlightDownload=page.waitForEvent('download');await page.locator('#save-project').click();const hd=await highlightDownload;const highlightJSON=path.join(scratch,'highlight.json');await hd.saveAs(highlightJSON);assert.deepEqual(JSON.parse(fs.readFileSync(highlightJSON,'utf8')).highlight,savedHighlight);
  await page.locator('#sample-project').click();await setTime(1);assert.equal((await state()).mode,'highlight');await page.locator('#fit-highlight').click();h=(await state()).highlight;assert.ok(Math.abs(h.width/h.height-320/448)<.01);
  await page.locator('#card-details').evaluate(el=>el.open=false);await resetScroll(page);await capture(page,'panel-highlight.png');await page.setViewportSize({width:420,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture(page,'panel-highlight-narrow.png');
  assert.deepEqual(await page.evaluate(()=>CardModel.validate(CardPanel.getProject())),[]);
  assert.deepEqual(errors,[]);
  const hostPage=await browser.newPage();hostPage.on('pageerror',error=>errors.push(error.message));await hostPage.route('**/js/bridge.js',route=>route.fulfill({contentType:'application/javascript',body:'window.CardBridge={hasHost:true,render:async function(project,onProgress){onProgress(.5);if(window.holdRender)return new Promise(resolve=>window.finishRender=resolve);if(window.renderError)throw window.renderError;return window.renderResult || null;},cancelRender:function(){},importRendered:async function(){return {imported:true};},openOutputFolder:async function(){window.folderOpened=true;}};'}));
  await hostPage.goto(url);await hostPage.locator('#render').click();await hostPage.waitForFunction(()=>document.getElementById('status-text').textContent.includes('中止'));assert.equal(await hostPage.locator('#render').isEnabled(),true);assert.equal((await hostPage.locator('#render-note').textContent()).includes('50%'),false);
  await hostPage.evaluate(()=>window.holdRender=true);await hostPage.locator('#render').click();
  await hostPage.locator('.card-row').nth(1).dispatchEvent('click');
  assert.match(await hostPage.locator('#selected-name').textContent(),/カード 1/);
  assert.equal(await hostPage.locator('[data-media]').first().isDisabled(),true);
  assert.equal(await hostPage.locator('[data-field="flipAt"]').isDisabled(),true);
  assert.equal(await hostPage.locator('#media-scale-slider').isDisabled(),true);assert.equal(await hostPage.locator('#reset-media').isDisabled(),true);
  const beforeBusyMode=await hostPage.evaluate(()=>JSON.parse(JSON.stringify(CardPanel.getProject())));assert.equal(await hostPage.locator('#mode-highlight').isDisabled(),true);await hostPage.locator('#mode-highlight svg').dispatchEvent('click');await hostPage.locator('#mode-cards').dispatchEvent('keydown',{key:'ArrowRight',bubbles:true});assert.deepEqual(await hostPage.evaluate(()=>JSON.parse(JSON.stringify(CardPanel.getProject()))),beforeBusyMode,'busy mode thumbnail and Arrow keys cannot mutate the project');
  await hostPage.locator('#media-scale-slider').evaluate(el=>{el.value='300';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await hostPage.evaluate(()=>CardPanel.getProject().cards[0].mediaScale),100);
  await hostPage.locator('#card-count').evaluate(el=>{el.value='10';el.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await hostPage.evaluate(()=>CardPanel.getProject().cards.length),3);
  await hostPage.evaluate(()=>{window.finishRender(null);window.holdRender=false;});
  await hostPage.waitForFunction(()=>!document.getElementById('render').disabled);
  await hostPage.locator('#mode-highlight').click();await hostPage.locator('#highlight-shape').selectOption('polygon');await hostPage.locator('#edit-polygon').click();await hostPage.locator('#remove-point').click();assert.equal(await hostPage.locator('#remove-point').isDisabled(),true);await hostPage.evaluate(()=>window.holdRender=true);await hostPage.locator('#render').click();
  assert.equal(await hostPage.locator('#add-layer').isDisabled(),true);assert.equal(await hostPage.locator('#highlight-shape').isDisabled(),true);assert.equal(await hostPage.locator('#layer-width').isDisabled(),true);
  const busyLayerCount=await hostPage.evaluate(()=>CardPanel.getProject().highlight.layers.length);await hostPage.locator('#add-layer').dispatchEvent('click');assert.equal(await hostPage.evaluate(()=>CardPanel.getProject().highlight.layers.length),busyLayerCount);
  await hostPage.evaluate(()=>{window.finishRender(null);window.holdRender=false;});await hostPage.waitForFunction(()=>!document.getElementById('render').disabled);assert.equal(await hostPage.locator('#remove-point').isDisabled(),true);
  await hostPage.evaluate(()=>window.renderResult={outputPath:'C:/x.mov',imported:false,importError:'project is closed'});await hostPage.locator('#render').click();await hostPage.waitForFunction(()=>document.getElementById('export-result').hidden===false);assert.match(await hostPage.locator('#error-text').textContent(),/project is closed/);assert.equal((await hostPage.locator('#status-text').textContent()).includes('project is closed'),false);await hostPage.locator('#retry-import').click();await hostPage.waitForFunction(()=>document.getElementById('result-heading').textContent.includes('読み込みました'));await hostPage.locator('#open-output').click();await hostPage.waitForFunction(()=>window.folderOpened===true);
  await hostPage.evaluate(()=>window.renderError={message:'カード1の素材が見つかりません。画像を選び直してください。',technicalDetails:'ffmpeg internal diagnostic example'});
  await hostPage.locator('#render').click();await hostPage.waitForFunction(()=>document.getElementById('status-text').textContent.includes('素材が見つかりません'));
  assert.match(await hostPage.locator('#error-text').textContent(),/ffmpeg internal diagnostic/);
  assert.equal((await hostPage.locator('#status-text').textContent()).includes('ffmpeg'),false);
  const studio=await browser.newPage({viewport:{width:1120,height:780}});
  studio.on('pageerror',error=>errors.push(error.message));studio.on('dialog',dialog=>dialog.accept());
  const nativeFixture='data:image/png;base64,'+fixturePNG().toString('base64');
  await studio.route('**/js/bridge.js',route=>route.fulfill({contentType:'application/javascript',body:'window.nativePickerCalls=0;window.CardBridge={hasHost:true,mediaURL:function(){return '+JSON.stringify(nativeFixture)+';},pickMedia:async function(){window.nativePickerCalls++;var name=window.nativeFixtureName || "boss";return {path:"C:/fixtures/"+name+".png",url:'+JSON.stringify(nativeFixture)+',type:"image",name:name+".png"};},render:async function(){if(window.holdRender)return new Promise(resolve=>window.finishStudioRender=resolve);return null;},cancelRender:function(){window.cancelCalls=(window.cancelCalls || 0)+1;if(window.finishStudioRender){window.holdRender=false;window.finishStudioRender(null);}}};'}));
  await studio.goto(url);
  const studioState=()=>studio.evaluate(()=>JSON.parse(JSON.stringify(CardPanel.getProject())));
  const materials=p=>p.cards.map(c=>({id:c.id,name:c.name,mediaPath:c.mediaPath,mediaType:c.mediaType,mediaOffset:c.mediaOffset,mediaScale:c.mediaScale,mediaX:c.mediaX,mediaY:c.mediaY,dropAt:c.dropAt,flipAt:c.flipAt}));
  const studioFill=async(selector,value)=>{await studio.locator(selector).fill(String(value));await studio.locator(selector).blur();};
  async function assertStudioMode(mode){assert.equal((await studioState()).mode,mode);assert.equal(await studio.locator('[data-mode-value][aria-selected="true"]').count(),1);assert.equal(await studio.locator('#mode-'+mode).getAttribute('aria-selected'),'true');assert.equal(await studio.locator('#mode-'+mode).getAttribute('tabindex'),'0');assert.equal(await studio.locator('[data-mode-value][tabindex="-1"]').count(),2);await studio.waitForFunction(mode=>{const s=getComputedStyle(document.getElementById('mode-'+mode));return [s.backgroundColor,s.color,s.borderBottomColor].some(value=>{const c=value.match(/[\d.]+/g);return c && +c[2]>+c[0]+30 && +c[2]>+c[1]+10;});},mode,{timeout:3000});}
  async function selectStudioMode(mode){await studio.locator('#mode-'+mode+' svg').click();await assertStudioMode(mode);}
  assert.equal(await studio.locator('[data-mode-value]').count(),3);
  assert.equal(await studio.locator('#looks-grid,.look-library,[data-look]').count(),0,'built-in look library is absent from the interface');assert.equal(await studio.evaluate(()=>typeof window.CardLooks),'undefined','removed look-library script is not loaded in the panel');
  for(const [mode,label]of [['cards',/カード/],['trapezoid',/台形|3分割/],['highlight',/画像|強調/]]){const tile=studio.locator('#mode-'+mode);assert.match(await tile.textContent(),label);assert.equal(await tile.locator('svg').isVisible(),true);const thumb=await tile.locator('svg').boundingBox();assert.ok(thumb.width>=60 && thumb.height>=32,'mode selector shows a thumbnail rather than a small icon');}
  await studio.evaluate(()=>{var p=CardPanel.getProject();CardModel.resizeCards(p,5);p.cards.slice(3).forEach(function(c,index){Object.assign(c,{name:'Extra '+(index+4),mediaPath:'C:/fixtures/extra-'+index+'.png',mediaType:'image',mediaScale:143+index,mediaX:-19,mediaY:24,mediaOffset:.75});});Object.assign(p.highlight,{shape:'polygon',rotation:11,width:600,height:400,points:[{x:.12,y:.08},{x:.93,y:.04},{x:.9,y:.91},{x:.07,y:.88}]});Object.assign(p.highlight.layers[0],{color:'#ff84b8',width:7,glow:13});CardPanel.setProject(p);});
  const modePreservedState=await studioState();
  for(const mode of ['trapezoid','highlight','cards']){await selectStudioMode(mode);const selectedState=await studioState();assert.deepEqual(materials(selectedState),materials(modePreservedState),'clicking a mode thumbnail retains all five materials and adjustments');assert.deepEqual(selectedState.highlight,modePreservedState.highlight,'mode thumbnails retain custom polygon points and layers');assert.deepEqual(selectedState.trapezoid,modePreservedState.trapezoid);assert.equal(await studio.locator('.card-row').count(),mode==='highlight'?1:mode==='trapezoid'?3:5);}
  await studio.locator('#mode-cards').focus();
  for(const [key,mode]of [['ArrowRight','trapezoid'],['ArrowRight','highlight'],['ArrowRight','cards'],['End','highlight'],['Home','cards'],['ArrowLeft','highlight']]){await studio.locator('[data-mode-value][aria-selected="true"]').press(key);await assertStudioMode(mode);assert.equal(await studio.evaluate(()=>document.activeElement.id),'mode-'+mode);assert.deepEqual(materials(await studioState()),materials(modePreservedState));assert.deepEqual((await studioState()).highlight,modePreservedState.highlight);}
  await studio.locator('#mode-trapezoid').focus();await studio.locator('#mode-trapezoid').press('Enter');await assertStudioMode('trapezoid');assert.deepEqual(materials(await studioState()),materials(modePreservedState));await selectStudioMode('cards');
  const compactLayout=await studio.evaluate(()=>{const b=document.getElementById('render').getBoundingClientRect(),preview=document.getElementById('preview').getBoundingClientRect(),transport=document.querySelector('.transport').getBoundingClientRect(),status=document.getElementById('status').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,pageScroll:document.scrollingElement.scrollHeight>innerHeight+1,scrollY:scrollY,exportVisible:b.top>=0 && b.left>=0 && b.right<=innerWidth && b.bottom<=innerHeight,previewHeight:preview.height,previewWidth:preview.width,transportVisible:transport.top>=0 && transport.left>=0 && transport.right<=innerWidth && transport.bottom<=status.top+1,orange:getComputedStyle(document.getElementById('render')).backgroundColor};});
  assert.equal(compactLayout.overflow,false);assert.equal(compactLayout.pageScroll,false,'desktop columns scroll internally instead of scrolling the page');assert.equal(compactLayout.scrollY,0);assert.equal(compactLayout.exportVisible,true,'primary export stays visible at1120×780 without page scrolling');
  assert.ok(compactLayout.previewHeight>=300 && compactLayout.previewWidth>=500,'center preview uses the space freed by the removed library');assert.equal(compactLayout.transportVisible,true,'all preview transport controls fit above the status bar');
  const orange=compactLayout.orange.match(/[\d.]+/g).map(Number);assert.ok(orange[0]>190 && orange[1]>60 && orange[1]<210 && orange[2]<orange[0]-60,'export uses the orange action accent');
  await studio.locator('[data-media]').first().click();await studio.waitForFunction(()=>CardPanel.getProject().cards[0].mediaPath==='C:/fixtures/boss.png');
  await studio.waitForFunction(()=>Array.from(document.querySelectorAll('[data-thumb] img')).every(img=>img.complete && img.naturalWidth>0));
  await studioFill('#media-scale',137);await studioFill('#media-x',23);await studioFill('#media-y',-11);
  await studio.locator('.card-row').nth(1).click();assert.equal(await studio.locator('.card-row.selected').getAttribute('data-select'),(await studioState()).cards[1].id);assert.match(await studio.locator('#selected-name').textContent(),/カード 2/);
  await selectStudioMode('trapezoid');await studio.evaluate(()=>window.nativeFixtureName='right-panel');await studio.locator('[data-media]').nth(2).click();await studio.waitForFunction(()=>CardPanel.getProject().cards[2].mediaPath==='C:/fixtures/right-panel.png');
  await selectStudioMode('highlight');await studio.evaluate(()=>window.nativeFixtureName='emphasis');await studio.locator('[data-media]').first().click();await studio.waitForFunction(()=>CardPanel.getProject().cards[0].mediaPath==='C:/fixtures/emphasis.png');
  assert.equal(await studio.evaluate(()=>window.nativePickerCalls),3,'redesigned media tiles keep the native picker bridge in all three modes');
  await studioFill('[data-highlight-setting="rotation"]',17);await studio.locator('#highlight-shape').selectOption('polygon');
  await studioFill('#layer-width',9);await studio.locator('#layer-color').fill('#28c7ff');await studio.locator('#layer-color').blur();assert.ok((await studioState()).highlight.layers.some(layer=>layer.color==='#28c7ff' && layer.width===9));
  await openSavedPresets(studio);await studio.locator('#preset-name').fill('My saved outline');await studio.locator('#save-preset').click();const savedStudioProject=await studioState();
  assert.equal(await studio.locator('#saved-preset-tiles [data-preset]').count(),1);
  await studioFill('#layer-width',2);await studio.locator('#layer-color').fill('#ffffff');await studio.locator('#layer-color').blur();await studioFill('[data-highlight-setting="rotation"]',0);assert.notDeepEqual((await studioState()).highlight,savedStudioProject.highlight);await studio.locator('#saved-preset-tiles [data-preset="0"]').click();assert.deepEqual(await studioState(),savedStudioProject);assert.equal(await studio.locator('#saved-preset-tiles [data-preset="0"]').getAttribute('aria-pressed'),'true');
  await studio.reload();await openSavedPresets(studio);assert.match(await studio.locator('#saved-preset-tiles [data-preset="0"]').textContent(),/My saved outline/);await studio.locator('#saved-preset-tiles [data-preset="0"]').click();assert.deepEqual(await studioState(),savedStudioProject,'saved preset tile survives a full panel reload');
  await studio.evaluate(()=>window.holdRender=true);await studio.locator('#render').click();assert.equal(await studio.locator('#saved-preset-tiles [data-preset="0"]').isDisabled(),true);await studio.locator('#saved-preset-tiles [data-preset="0"]').dispatchEvent('click');assert.deepEqual(await studioState(),savedStudioProject,'busy saved-preset tile cannot replace the in-progress project');await studio.locator('#cancel-render').click();await studio.waitForFunction(()=>!document.getElementById('render').disabled);assert.equal(await studio.evaluate(()=>window.cancelCalls),1);assert.match(await studio.locator('#status-text').textContent(),/中止/);
  await studio.locator('#saved-presets').evaluate(el=>el.open=false);await resetScroll(studio);await capture(studio,'panel-preview.png');
  for(const width of [420,384])for(const mode of ['cards','trapezoid','highlight']){await studio.setViewportSize({width:width,height:780});await selectStudioMode(mode);assert.equal(await studio.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow in '+mode+' at'+width+'px');}
  await resetScroll(studio);await capture(studio,'panel-preview-narrow.png');
  await studio.setViewportSize({width:1120,height:780});await resetScroll(studio);assert.equal(await studio.evaluate(()=>document.documentElement.scrollWidth>innerWidth || document.scrollingElement.scrollHeight>innerHeight+1),false);
  assert.deepEqual(errors,[]);
  console.log('UI smoke passed: removed look library/enlarged preview/visible transport, three mode thumbnails/keyboard/busy guards, five retained materials/custom polygon/layers, native-picker fixtures in3modes, fixed export1120×780, saved presets/manual layer edits/reload, no overflow420/384, and all existing media/highlight/JSON/output retry/cancel regressions.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();fs.rmSync(scratch,{recursive:true,force:true});});
