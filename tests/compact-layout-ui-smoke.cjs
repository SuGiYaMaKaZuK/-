'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (route === '/' ? '/index.html' : decodeURIComponent(route)));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, bytes) => {
    if (err) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  });
});
let browser;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:320, height:360}}), errors = [];
  page.setDefaultTimeout(6000); page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
  await page.route('**/js/bridge.js', route => route.fulfill({
    contentType:'application/javascript',
    body:fs.readFileSync(path.join(root,'js/bridge.js'),'utf8') + `
      Object.assign(CardBridge, {hasHost:true, pickMedia: async () => ({path:location.origin+'/examples/media/boss.png',url:location.origin+'/examples/media/boss.png',name:'ボス.png',type:'image'}),
        render: async () => new Promise(resolve=>window.endCompactRender=resolve), cancelRender: () => window.endCompactRender(null)});
    `
  }));
  await page.goto(url); await page.waitForFunction(()=>window.CardDiscordUI);
  const ui=selector=>page.locator(selector);
  const stored=()=>page.evaluate(()=>localStorage.getItem(CardLibrary.key));
  async function onscreen(selector) {
    const {width,height}=page.viewportSize(), r=await ui(selector).boundingBox();
    assert.ok(r && r.width>0 && r.height>0 && r.x>=-1 && r.y>=-1 && r.x+r.width<=width+1 && r.y+r.height<=height+1,selector+' clipped '+JSON.stringify(r));
  }
  async function fits(selector) {
    const el=ui(selector);
    assert.ok(await el.evaluate(n=>n.scrollWidth<=n.clientWidth+1),selector+' has horizontal overflow');
  }
  assert.equal(await ui('.template-shortcuts,[data-template-shortcut],.sidebar-footer,#environment,.library-header').count(),0);
  assert.equal(await ui('#plugin-channels').count(),1);
  await onscreen('#toggle-template-panel'); await onscreen('#toggle-channel-sidebar'); await onscreen('#open-assets-library');
  await ui('#empty-open-templates').click(); assert.equal(await ui('#template-panel-slot').isVisible(),true);
  for (const size of [{width:320,height:360},{width:384,height:420},{width:420,height:540},{width:760,height:420}]) {
    await page.setViewportSize(size);
    for(const id of ['#template-cards','#template-trapezoid','#template-quad','#template-highlight']) await onscreen(id);
    await fits('.studio-workspace'); await fits('#template-panel');
  }
  await page.setViewportSize({width:420,height:540});
  await page.screenshot({path:path.join(root,'examples/panel-compact-library.png')});
  await ui('#toggle-channel-sidebar').click(); await ui('#add-group').click(); await ui('#group-name').fill('ゲーム実況'); await ui('#confirm-group').click();
  assert.equal(await ui('#compact-group-name').textContent(),'ゲーム実況');
  await ui('#toggle-channel-sidebar').click();
  const menu=await ui('#channels-drawer').boundingBox(); assert.ok(menu.height<280,'short menus should fit their contents');
  await page.getByRole('tab',{name:'ゲーム実況',exact:true}).click({button:'right'}); await ui('#group-actions-dialog .group-close').click();
  await page.keyboard.press('Escape'); assert.equal(await ui('#channels-drawer').isVisible(),false);
  const beforeResize=await stored();
  await ui('#toggle-channel-sidebar').click(); await page.setViewportSize({width:1120,height:700});
  await page.waitForFunction(()=>!document.getElementById('channels-drawer').open);
  assert.equal(await ui('#plugin-sidebar #plugin-channels').count(),1);
  await page.setViewportSize({width:320,height:360}); await page.waitForSelector('#compact-channel-slot #plugin-channels');
  assert.equal(await stored(),beforeResize);

  await ui('#template-cards').click();
  await onscreen('#tab-media'); await onscreen('#save-to-group'); await onscreen('#render');
  assert.equal(await ui('#pane-media').isVisible(),true); assert.equal(await ui('#pane-settings').isVisible(),false);
  await ui('[data-thumb]').first().click(); await page.waitForFunction(()=>!CardPanel.isMediaPending() && document.querySelector('[data-thumb] img')?.naturalWidth>0);
  await ui('#tab-settings').click(); await ui('#media-x').fill('28'); await ui('#media-x').press('Tab');
  await ui('#tab-settings').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await ui('#tab-preview').getAttribute('aria-selected'),'true');
  await onscreen('#play'); await onscreen('#scrub'); assert.ok((await ui('#preview').boundingBox()).width>=100);
  await ui('#tab-media').click(); await ui('#tab-settings').click(); assert.equal(await ui('#media-x').inputValue(),'28');
  await ui('#editor-more summary').click(); await onscreen('#open-sabu-picker');
  await page.keyboard.press('Escape'); assert.equal(await ui('#editor-dialog').isVisible(),true);
  assert.ok(!await ui('#editor-more').evaluate(n=>n.open));
  await ui('#editor-more summary').click(); await ui('#open-sabu-picker').click(); await onscreen('#sabu-picker-title');
  await ui('[data-close-dialog="sabu-picker-dialog"]').click(); assert.ok(!await ui('#editor-more').evaluate(n=>n.open));
  await page.setViewportSize({width:1120,height:700});
  await page.waitForFunction(()=>!document.getElementById('pane-preview').hidden);
  for(const id of ['#pane-media','#pane-preview','#pane-settings','#open-sabu-picker','#save-copy']) assert.ok(await ui(id).isVisible());
  await ui('#media-x').focus(); await page.setViewportSize({width:384,height:420});
  await page.waitForFunction(()=>document.getElementById('tab-settings').getAttribute('aria-selected')==='true');
  assert.equal(await ui('#media-x').inputValue(),'28');
  await page.setViewportSize({width:420,height:540}); await ui('#tab-media').click();
  await page.screenshot({path:path.join(root,'examples/panel-compact-editor.png')});
  await page.setViewportSize({width:320,height:360});
  await ui('#render').click(); await page.waitForFunction(()=>window.endCompactRender);
  await onscreen('#cancel-render'); await ui('#cancel-render').click(); await page.waitForFunction(()=>!CardPanel.isBusy());
  await ui('#save-to-group').click(); await ui('#preset-name').fill('小窓で作った演出'); await ui('#save-preset').click();
  assert.equal(await ui('#editor-dialog').isVisible(),false); await ui('[data-open-preset]').click(); assert.ok(await ui('#pane-preview').isVisible());
  await ui('#close-editor').click();

  await ui('#open-image-library').click(); assert.equal(await ui('#compact-channel-slot').isVisible(),false);
  await ui('#toggle-channel-sidebar').click(); await ui('#add-media-group').click(); await ui('#media-group-name').fill('差し込み画像'); await ui('#confirm-media-group').click();
  await onscreen('#media-collection-search'); await onscreen('#media-collection-manage'); await fits('#media-collection');
  await ui('#media-collection-manage').click(); await ui('#choose-sabu-media').click();
  await page.waitForFunction(()=>!document.getElementById('save-sabu').disabled); await ui('#save-sabu').click();
  await page.waitForFunction(()=>!document.getElementById('sabu-dialog').open);
  assert.equal(await ui('#media-collection-grid .media-tile').count(),1);
  const state=await page.evaluate(()=>CardLibraryPanel.getState());
  assert.equal(state.assets.length,1); assert.equal(state.mediaGroups.image.assignments[0].groupId,state.mediaGroups.image.activeGroupId);
  await page.reload(); await ui('#open-image-library').click(); assert.equal(await ui('#compact-group-name').textContent(),'差し込み画像');
  assert.equal(await ui('#media-collection-grid .media-tile').count(),1);
  assert.deepEqual(errors,[]);
  console.log('Compact UI passed: 320×360 to 1120×700, original/saved assets, contextual groups, overflow actions, editor panes and focus, resize, render cancellation, placement registration and persistence.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
