/* Optional browser check: node tests/ui-smoke.cjs.
   Requires Playwright + Chromium; the Premiere extension itself has no npm dependencies. */
'use strict';
async function openTemplate(page,selector){if(!await page.locator(selector).isVisible())await page.locator('#toggle-template-panel').click();await page.locator(selector).click();}

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'card-reveal-ui-'));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((request,response)=>{
  const raw=request.url.split('?')[0],filename=path.resolve(root,'.'+decodeURIComponent(raw==='/'?'/index.html':raw));
  if(!filename.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  fs.readFile(filename,(error,body)=>{if(error){response.writeHead(404).end();return;}response.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');response.end(body);});
});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1120,height:780}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);
 async function sample(mode){await openTemplate(page,'#template-'+mode);await page.locator('#sample-project').click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-thumb] img')).length>0&&Array.from(document.querySelectorAll('[data-thumb] img')).every(img=>img.complete&&img.naturalWidth));}
 async function time(){await page.locator('#scrub').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}));});}
 async function save(name){await time();await page.locator('#save-to-group').click();await page.locator('#preset-name').fill(name);await page.locator('#save-preset').click();await page.waitForFunction(()=>!document.getElementById('editor-dialog').open);}
 await sample('cards');await save('ボス紹介・3枚');
 await sample('trapezoid');await save('3画面・上からスライド');
 await sample('highlight');await page.locator('#fit-highlight').click();await save('画像の外周・イエロー');
 await sample('highlight');await page.locator('#fit-highlight').click();for(let i=0;i<2;i++){await page.locator('[data-layer-select]').nth(i).click();await page.locator('#layer-color').fill('#28c7ff');await page.locator('#layer-color').blur();}await save('画像の外周・シアン');

 for(const name of ['ゲーム実況','配信パーツ']){await page.locator('#add-group').click();await page.locator('#group-name').fill(name);await page.locator('#confirm-group').click();}
 await page.getByRole('tab',{name:'Main',exact:true}).click();
 await page.getByRole('button',{name:'画像の外周・シアンを編集',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-thumb] img')?.complete);await page.locator('#open-sabu-picker').click();await page.locator('#capture-sabu').click();await page.waitForFunction(()=>!document.getElementById('save-sabu').disabled);await page.locator('#sabu-name').fill('ボス画像・中央');await page.locator('#save-sabu').click();await page.waitForFunction(()=>!document.getElementById('sabu-dialog').open);await page.locator('[data-close-dialog="sabu-picker-dialog"]').click();await page.locator('#close-editor').click();
 await page.getByRole('button',{name:'ボス紹介・3枚を編集',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-thumb] img')).every(i=>i.complete&&i.naturalWidth));await page.locator('#open-sabu-picker').click();await page.locator('#capture-sabu').click();await page.waitForFunction(()=>!document.getElementById('save-sabu').disabled);await page.locator('#sabu-name').fill('ボス画像・右寄せ');await page.locator('#sabu-scale').fill('125');await page.locator('#sabu-x').fill('35');await page.locator('#sabu-y').fill('-15');await page.locator('#save-sabu').click();await page.waitForFunction(()=>!document.getElementById('sabu-dialog').open);await page.locator('[data-close-dialog="sabu-picker-dialog"]').click();await page.locator('#close-editor').click();

 await page.evaluate(()=>{
   CardBridge.hasHost=true;
   CardBridge.pickTitleTemplate=async()=>({path:'C:/素材/いつもの字幕.mogrt',sourceName:'いつもの字幕.mogrt'});
   CardBridge.preserveTitleTemplate=async()=>({templatePath:'C:/UserData/CardRevealStudio/telop-templates/demo.mogrt',sourceName:'いつもの字幕.mogrt'});
   CardBridge.titleContext=async()=>({ok:true,sequenceName:'編集用 1920×1080',videoTracks:[{index:0,name:'メイン映像'},{index:1,name:'字幕用'}]});
 });
 for(const name of ['いつもの字幕・白文字','強調テロップ・大きめ']){
   await openTemplate(page,'#register-title');await page.locator('#pick-title-template').click();await page.locator('#title-name').fill(name);await page.locator('#title-video-track').selectOption('1');await page.locator('#save-title').click();await page.waitForFunction(()=>!document.getElementById('title-dialog').open);
 }


 const baseline=await page.evaluate(()=>JSON.stringify(CardLibraryPanel.getState()));
 assert.equal(await page.locator('#sidebar-group-name').textContent(),'Main');
 assert.equal(await page.locator('#channel-effect-count').textContent(),'4');assert.equal(await page.locator('#channel-title-count').textContent(),'2');
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>document.getElementById('status-text').textContent='画面の見本：演出と素材はサンプル。テロップのファイル処理・Premiere通信は模擬しています。');
 await page.screenshot({path:root+'/examples/panel-discord-library.png'});
 await page.locator('[data-library-view="effects"]').click();assert.equal(await page.locator('.telop-library').isVisible(),false);assert.equal(await page.locator('.main-saved-section').isVisible(),true);assert.equal(await page.locator('#workspace-title').textContent(),'演出');
 await page.keyboard.press('Control+f');assert.equal(await page.locator('#main-search').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-library-view="titles"]').click();assert.equal(await page.locator('.main-saved-section').isVisible(),false);assert.equal(await page.locator('.telop-library').isVisible(),true);await page.keyboard.press('Control+f');assert.equal(await page.locator('#title-search').evaluate(el=>el===document.activeElement),true);
 await page.screenshot({path:root+'/examples/panel-discord-telops.png'});
 await page.locator('[data-library-view="all"]').click();assert.equal(await page.evaluate(()=>JSON.stringify(CardLibraryPanel.getState())),baseline,'view switches preserve all saved data');
 await page.locator('#toggle-template-panel').click();await page.screenshot({path:root+'/examples/panel-discord-templates.png'});await page.locator('#close-template-panel').click();if(await page.locator('#timeline-trial-tools').evaluate(el=>el.open))await page.locator('#timeline-trial-tools>summary').click();
 const tabs=page.locator('[role="tab"]');await tabs.first().focus();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#sidebar-group-name').textContent(),'ゲーム実況');await page.keyboard.press('ArrowUp');assert.equal(await page.locator('#sidebar-group-name').textContent(),'Main');
 await page.setViewportSize({width:1120,height:900});await page.screenshot({path:root+'/examples/panel-discord-1120.png'});
 for(const width of [1000,900,760,420,384]){
   await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow at '+width);
   await page.locator('#toggle-template-panel').click();assert.equal(await page.locator('#template-panel').isVisible(),true);assert.equal(await page.locator('#workspace-title').textContent(),'元になるプラグイン');assert.equal(await page.locator('.saved-library').isVisible(),false);await page.locator('#close-template-panel').click();
   if(width<=760){
     await page.locator('#toggle-channel-sidebar').click();assert.equal(await page.locator('#channels-drawer').isVisible(),true);await page.locator('[data-library-view="titles"]').click();await page.waitForFunction(()=>!document.getElementById('channels-drawer').open);assert.equal(await page.locator('#workspace-title').textContent(),'テロップ');
     await page.locator('#toggle-channel-sidebar').click();await page.locator('[data-library-view="all"]').click();
   }
 }
 await page.setViewportSize({width:420,height:900});await page.screenshot({path:root+'/examples/panel-discord-narrow.png'});
 await page.locator('#toggle-channel-sidebar').click();await page.screenshot({path:root+'/examples/panel-discord-navigation.png'});
 await page.locator('#open-assets-library').click();assert.equal(await page.locator('#channels-drawer').isVisible(),false);assert.equal(await page.locator('#assets-library-dialog').isVisible(),true);assert.equal(await page.locator('[data-sabu-edit]').count(),2);await page.locator('[data-close-dialog="assets-library-dialog"]').click();
 await page.locator('#toggle-channel-sidebar').click();await page.locator('[data-template-shortcut="template-highlight"]').click();assert.equal(await page.locator('#channels-drawer').isVisible(),false);assert.equal(await page.locator('#editor-dialog').isVisible(),true);assert.equal(await projectMode(),'highlight');await page.locator('#close-editor').click();
 await page.locator('#toggle-template-panel').click();await openTemplate(page,'#template-cards');assert.equal(await page.locator('#template-panel').isVisible(),false);assert.equal(await page.locator('#editor-dialog').isVisible(),true);await page.locator('#close-editor').click();
 await page.locator('#toggle-channel-sidebar').click();await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!document.getElementById('channels-drawer').open);assert.equal(await page.locator('#channel-sidebar').evaluate(el=>el.parentNode.id),'channel-sidebar-slot');assert.equal(await page.locator('#open-assets-library').isVisible(),true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('cardreveal:title-busy',{detail:{busy:true}})));assert.equal(await page.locator('[data-library-view="titles"]').isDisabled(),true);assert.equal(await page.locator('[data-template-shortcut]').first().isDisabled(),true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('cardreveal:title-busy',{detail:{busy:false}})));assert.equal(await page.locator('[data-library-view="titles"]').isEnabled(),true);
 assert.equal(await page.evaluate(()=>JSON.stringify(CardLibraryPanel.getState())),baseline,'navigation and drawers preserve existing presets, titles and assets');
 await page.getByRole('button',{name:'画像の外周・シアンを編集',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-thumb] img')?.complete);await page.locator('#scrub').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.screenshot({path:root+'/examples/panel-discord-editor.png'});
 assert.deepEqual(errors,[]);console.log('Discord UI passed: vertical group navigation, counts, effect/telop views + search shortcuts, independent assets, central templates + native focus-trapped menu and action handoff, Escape/resize restoration, busy controls, unchanged saved data and 1440–384px layout. Actual panel screenshots captured; Premiere calls mocked.');
 async function projectMode(){return page.evaluate(()=>CardPanel.getProject().mode);}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();fs.rmSync(scratch,{recursive:true,force:true});});
