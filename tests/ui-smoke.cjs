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
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(url);
  const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(CardPanel.getProject())));
  const setTime=time=>page.locator('#scrub').evaluate((el,time)=>{el.value=String(time);el.dispatchEvent(new Event('input',{bubbles:true}));},time);
  const fill=async(selector,value)=>{await page.locator(selector).fill(String(value));await page.locator(selector).blur();};
  const pixel=(x,y)=>page.evaluate(({x,y})=>{const c=document.querySelector('canvas'),p=CardPanel.getProject();return Array.from(c.getContext('2d').getImageData(Math.round(x*c.width/p.width),Math.round(y*c.height/p.height),1,1).data);},{x,y});
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
  await setTime(6);await page.locator('canvas').scrollIntoViewIfNeeded();
  const c=(await state()).cards[0],bounds=await page.locator('canvas').boundingBox(),position={x:bounds.x+c.x/1920*bounds.width,y:bounds.y+c.y/1080*bounds.height};
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

  await page.locator('#background-mode').selectOption('solid');await setTime(0);assert.equal(await page.evaluate(()=>document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[3]),255);
  await page.locator('#background-mode').selectOption('transparent');assert.equal(await page.evaluate(()=>document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[3]),0);
  await fill('[data-split-setting="angle"]',12);await fill('[data-split-setting="interval"]',.4);await fill('[data-split-setting="slideDuration"]',1);
  await page.locator('#advanced-settings summary').click();await page.locator('[data-setting="fps"]').selectOption('120');assert.equal((await state()).fps,120);await page.locator('[data-setting="fps"]').selectOption('90');assert.equal((await state()).fps,90);
  assert.deepEqual(await page.evaluate(()=>CardModel.validate(CardPanel.getProject())),[]);
  await page.locator('#advanced-settings summary').click();await setTime(4);await page.locator('canvas').scrollIntoViewIfNeeded();
  const splitBounds=await page.locator('canvas').boundingBox();await page.mouse.click(splitBounds.x+splitBounds.width*.9,splitBounds.y+splitBounds.height*.5);assert.match(await page.locator('#selected-name').textContent(),/右のパネル/);
  await page.locator('#preset-name').fill('台形3分割');await page.locator('#save-preset').click();await page.locator('#mode-cards').click();await page.locator('#load-preset').click();assert.equal((await state()).mode,'trapezoid');
  await page.locator('#sample-project').click();await page.locator('#card-details').evaluate(el=>el.open=false);await setTime(4);await fill('#media-scale',110);await fill('#media-x',20);await page.waitForTimeout(100);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(root,'examples','panel-split.png'),fullPage:true});
  await page.setViewportSize({width:420,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(root,'examples','panel-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.locator('#mode-cards').click();await setTime(4);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(root,'examples','panel.png'),fullPage:true});await page.setViewportSize({width:420,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(root,'examples','panel-cards-narrow.png'),fullPage:true});
  await page.evaluate(()=>{var p=CardPanel.getProject();p.cards[0].name='x" onclick="window.injected=true';CardPanel.setProject(p);});assert.equal(await page.locator('.card-name').first().getAttribute('onclick'),null);
  await page.evaluate(()=>{var p=CardPanel.getProject();p.cards.forEach(c=>{delete c.mediaScale;delete c.mediaX;delete c.mediaY;});CardPanel.setProject(p);});assert.equal(await page.locator('#media-scale').inputValue(),'100');assert.equal(await page.locator('#media-x').inputValue(),'0');assert.equal(await page.locator('#media-y').inputValue(),'0');
  assert.deepEqual(errors,[]);
  const hostPage=await browser.newPage();await hostPage.route('**/js/bridge.js',route=>route.fulfill({contentType:'application/javascript',body:'window.CardBridge={hasHost:true,render:async function(project,onProgress){onProgress(.5);if(window.holdRender)return new Promise(resolve=>window.finishRender=resolve);if(window.renderError)throw window.renderError;return window.renderResult || null;},cancelRender:function(){},importRendered:async function(){return {imported:true};},openOutputFolder:async function(){window.folderOpened=true;}};'}));
  await hostPage.goto(url);await hostPage.locator('#render').click();await hostPage.waitForFunction(()=>document.getElementById('status-text').textContent.includes('中止'));assert.equal(await hostPage.locator('#render').isEnabled(),true);assert.equal((await hostPage.locator('#render-note').textContent()).includes('50%'),false);
  await hostPage.evaluate(()=>window.holdRender=true);await hostPage.locator('#render').click();
  await hostPage.locator('.card-row').nth(1).dispatchEvent('click');
  assert.match(await hostPage.locator('#selected-name').textContent(),/カード 1/);
  assert.equal(await hostPage.locator('[data-media]').first().isDisabled(),true);
  assert.equal(await hostPage.locator('[data-field="flipAt"]').isDisabled(),true);
  assert.equal(await hostPage.locator('#media-scale-slider').isDisabled(),true);assert.equal(await hostPage.locator('#reset-media').isDisabled(),true);
  await hostPage.locator('#media-scale-slider').evaluate(el=>{el.value='300';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await hostPage.evaluate(()=>CardPanel.getProject().cards[0].mediaScale),100);
  await hostPage.locator('#card-count').evaluate(el=>{el.value='10';el.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await hostPage.evaluate(()=>CardPanel.getProject().cards.length),3);
  await hostPage.evaluate(()=>{window.finishRender(null);window.holdRender=false;});
  await hostPage.waitForFunction(()=>!document.getElementById('render').disabled);
  await hostPage.evaluate(()=>window.renderResult={outputPath:'C:/x.mov',imported:false,importError:'project is closed'});await hostPage.locator('#render').click();await hostPage.waitForFunction(()=>document.getElementById('export-result').hidden===false);assert.match(await hostPage.locator('#error-text').textContent(),/project is closed/);assert.equal((await hostPage.locator('#status-text').textContent()).includes('project is closed'),false);await hostPage.locator('#retry-import').click();await hostPage.waitForFunction(()=>document.getElementById('result-heading').textContent.includes('読み込みました'));await hostPage.locator('#open-output').click();await hostPage.waitForFunction(()=>window.folderOpened===true);
  await hostPage.evaluate(()=>window.renderError={message:'カード1の素材が見つかりません。画像を選び直してください。',technicalDetails:'ffmpeg internal diagnostic example'});
  await hostPage.locator('#render').click();await hostPage.waitForFunction(()=>document.getElementById('status-text').textContent.includes('素材が見つかりません'));
  assert.match(await hostPage.locator('#error-text').textContent(),/ffmpeg internal diagnostic/);
  assert.equal((await hostPage.locator('#status-text').textContent()).includes('ffmpeg'),false);
  console.log('UI smoke passed: live media scale/XY + known pixels + independent frames + defaults/persistence/reset/busy, sample, compact/details controls, layouts, sequence, drag, JSON, named presets, split mode/masks/background/FPS, clean errors, output retry/cancel, responsive screenshots.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();fs.rmSync(scratch,{recursive:true,force:true});});
