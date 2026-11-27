'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2] || path.join(__dirname,'..'));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const base='http://127.0.0.1:8126';
    await page.route(base+'/**',route=>{
      const f=path.resolve(root,'.'+new URL(route.request().url()).pathname);
      if(!f.startsWith(root+path.sep) || !fs.existsSync(f))return route.abort();
      return route.fulfill({path:f});
    });
    const ui=s=>page.locator(s), state=()=>page.evaluate(()=>CardPanel.getProject());
    await page.goto(base+'/index.html');await ui('#toggle-template-panel').click();
    await page.getByRole('button',{name:'4分割スライド',exact:true}).click();
    assert.equal(await ui('[data-select]').count(),4);assert.equal(await ui('#editor-title').textContent(),'4分割スライド');
    assert.equal(await ui('#quad-layout').inputValue(),'columns');
    await ui('#play').click();await page.waitForFunction(()=>CardPanel.getTime()>0.02 && CardPanel.getTime()<1);
    await ui('#play').click();await ui('#sample-project').click();
    await page.waitForFunction(()=>CardPanel.getProject().cards[3].mediaPath.endsWith('portal.png') && !CardPanel.isMediaPending());
    await ui('#play').click();await ui('#quad-layout').selectOption('grid');
    assert.equal(await ui('#split-angle-field').isVisible(),false);
    assert.deepEqual(await ui('.card-order').allTextContents(),['1 · 左上','2 · 右上','3 · 左下','4 · 右下']);
    await ui('#scrub').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input'));});
    const box=await ui('#preview').boundingBox();
    await ui('#preview').click({position:{x:box.width*.75,y:box.height*.75}});
    assert.ok((await ui('#selected-name').textContent()).includes('右下'));
    await ui('#media-x').fill('15');await ui('#media-x').blur();assert.equal((await state()).cards[3].mediaX,15);
    await ui('[data-split-setting="interval"]').fill('0');await ui('[data-split-setting="interval"]').blur();
    await ui('#undo-edit').click();assert.equal((await state()).quad.interval,.25);
    await ui('#redo-edit').click();assert.equal((await state()).quad.interval,0);
    await ui('#save-to-group').click();await ui('#preset-name').fill('四面の紹介');await ui('#save-preset').click();
    await page.waitForFunction(()=>!document.getElementById('editor-dialog').open);
    await page.reload();await ui('[data-open-preset]').click();
    const saved=await state();assert.equal(saved.mode,'quad');assert.equal(saved.quad.layout,'grid');
    assert.equal(saved.quad.interval,0);assert.ok(saved.cards[3].mediaPath.endsWith('portal.png'));assert.equal(saved.cards[3].mediaX,15);
    await page.setViewportSize({width:384,height:540});
    await page.getByRole('tab',{name:'設定',exact:true}).click();
    await ui('#quad-layout').selectOption('columns');assert.ok(await ui('#split-angle-field').isVisible());
    assert.deepEqual(errors,[]);console.log('Four-panel thumbnail, all samples, first replay, layout, fourth-panel hit testing, timing, undo, persistence and compact controls passed.');
  } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
