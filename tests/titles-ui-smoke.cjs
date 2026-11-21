/* Browser integration: node tests/titles-ui-smoke.cjs. Premiere calls are mocked. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const filename = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0]));
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(filename, (error, bytes) => { if (error) { response.writeHead(404).end(); return; } response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream'); response.end(bytes); });
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port, errors = [];
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1120, height: 780 } }); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('**/js/bridge.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.insertions=[];window.copies=[];
    window.CardBridge={hasHost:true,
      pickTitleTemplate:async function(){if(window.pickError)throw Error(window.pickError);return window.cancelPick?null:{path:'C:/素材/字幕 100%20.mogrt',sourceName:'字幕 100%20.mogrt'};},
      preserveTitleTemplate:async function(p){window.copies.push(p);return {templatePath:'C:/UserData/CardRevealStudio/telop-templates/copied.mogrt',sourceName:'字幕 100%20.mogrt'};},
      titleContext:async function(){return {ok:true,sequenceName:window.noSequence?null:'編集用 1920×1080',videoTracks:window.noSequence?[]:[{index:0,name:'メイン映像'},{index:1,name:'字幕用'}]};},
      insertTitle:async function(t){window.insertions.push(t);if(window.holdInsert)return await new Promise(resolve=>window.finishInsert=resolve);if(window.insertError)throw Error(window.insertError);return {ok:true,inserted:true,verified:!window.unverified,videoTrack:t.videoTrack==='auto'?1:t.videoTrack,startTicks:'900719925474099312345'};}
    };` }));
  await page.goto(url);
  // Cancellation and picker errors never fabricate a template.
  await page.locator('#register-title').click(); assert.equal(await page.locator('#title-dialog').isVisible(), true);
  assert.equal(await page.locator('#save-title').isDisabled(), true);
  await page.evaluate(() => window.cancelPick = true); await page.locator('#pick-title-template').click(); assert.equal(await page.locator('#save-title').isDisabled(), true);
  await page.evaluate(() => { window.cancelPick = false; window.pickError = '選択画面を開けません'; }); await page.locator('#pick-title-template').click(); assert.match(await page.locator('#title-error').textContent(), /選択画面/);
  await page.evaluate(() => delete window.pickError); await page.locator('#pick-title-template').click();
  assert.equal(await page.locator('#title-name').inputValue(), '字幕 100%20'); await page.locator('#title-name').fill('いつもの字幕・白文字'); await page.locator('#title-video-track').selectOption('1');
  // A quota failure keeps the dialog, metadata and preserved binary for retry.
  await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.locator('#save-title').click(); assert.match(await page.locator('#title-error').textContent(), /保存容量/); assert.equal(await page.evaluate(() => copies.length), 1);
  assert.equal(await page.evaluate(() => CardLibraryPanel.getState().titles.length), 0);
  await page.evaluate(() => Storage.prototype.setItem = window.originalSetItem); await page.keyboard.press('Control+s'); await page.waitForFunction(() => !document.getElementById('title-dialog').open);
  let saved = await page.evaluate(() => CardLibraryPanel.getState().titles[0]); assert.equal(saved.name, 'いつもの字幕・白文字'); assert.equal(saved.videoTrack, 1); assert.equal(await page.evaluate(() => copies.length), 1);
  assert.equal(saved.templatePath, 'C:/UserData/CardRevealStudio/telop-templates/copied.mogrt'); assert.equal(await page.locator('[data-insert-title]').count(), 1); assert.equal(await page.locator('#empty-group').isVisible(), false);
  // One click inserts the saved binary and track; in-flight and rapid second clicks do not duplicate it.
  await page.evaluate(() => window.holdInsert = true); await page.locator('[data-insert-title]').click(); await page.waitForFunction(() => typeof window.finishInsert === 'function');
  assert.equal(await page.locator('[data-insert-title]').isDisabled(), true); assert.equal(await page.locator('#register-title').isDisabled(), true); assert.equal(await page.locator('#add-sabu').isDisabled(), true); assert.equal(await page.locator('#template-cards').isDisabled(), true);
  await page.locator('[data-insert-title]').dispatchEvent('click'); assert.equal(await page.evaluate(() => insertions.length), 1); assert.deepEqual(await page.evaluate(() => insertions[0]), saved);
  await page.evaluate(() => { window.holdInsert = false; window.finishInsert({ ok: true, inserted: true, verified: true, videoTrack: 1, startTicks: '900719925474099312345' }); });
  await page.waitForFunction(() => !document.querySelector('[data-insert-title]').disabled); assert.match(await page.locator('#status-text').textContent(), /V2.*挿入しました/);
  await page.locator('[data-insert-title]').dispatchEvent('click'); assert.equal(await page.evaluate(() => insertions.length), 1);
  // Reopening after reload preserves the registered file and permits metadata-only changes.
  await page.reload(); assert.equal(await page.locator('[data-insert-title]').count(), 1);
  await page.locator('[data-manage-title]').click(); assert.equal(await page.locator('#title-name').inputValue(), saved.name); assert.equal(await page.locator('#title-video-track').inputValue(), '1');
  await page.locator('#title-name').fill('定番字幕'); await page.locator('#title-video-track').selectOption('auto'); await page.locator('#save-title').click(); await page.waitForFunction(() => !document.getElementById('title-dialog').open);
  assert.equal(await page.evaluate(() => copies.length), 0, 'metadata changes do not copy the template again'); saved = await page.evaluate(() => CardLibraryPanel.getState().titles[0]); assert.equal(saved.name, '定番字幕');
  await page.locator('#main-search').fill('mogrt'); assert.equal(await page.locator('[data-insert-title]').count(), 1); await page.locator('#main-search').fill('存在しない'); assert.equal(await page.locator('[data-insert-title]').count(), 0); await page.locator('#main-search').press('Escape');
  await page.evaluate(() => window.unverified = true); await page.locator('[data-insert-title]').click(); await page.waitForFunction(() => document.getElementById('status').classList.contains('error')); assert.match(await page.locator('#status-text').textContent(), /再度押す前/);
  await page.waitForTimeout(650); await page.evaluate(() => { window.unverified = false; window.insertError = '空きのビデオトラックを追加してください。'; }); await page.locator('[data-insert-title]').click(); await page.waitForFunction(() => document.getElementById('status-text').textContent.includes('空きの')); assert.equal(await page.locator('#status').evaluate(el => el.classList.contains('error')), true);
  // Registration before opening a sequence works; a missing saved V2 is not silently changed.
  await page.locator('[data-manage-title]').click(); await page.locator('#title-video-track').selectOption('1'); await page.locator('#save-title').click(); await page.waitForFunction(() => !document.getElementById('title-dialog').open);
  await page.evaluate(() => window.noSequence = true); await page.locator('[data-manage-title]').click(); await page.waitForFunction(() => document.getElementById('title-context-note').textContent.includes('登録は先に')); assert.equal(await page.locator('#title-video-track').inputValue(), '1'); assert.match(await page.locator('#title-video-track option:checked').textContent(), /ありません/);
  await page.locator('[data-close-dialog="title-dialog"]').click();
  // Group filtering and moving a title via its registration dialog.
  await page.locator('#add-group').click(); await page.locator('#group-name').fill('字幕集'); await page.locator('#confirm-group').click(); assert.equal(await page.locator('[data-insert-title]').count(), 0);
  const target = await page.evaluate(() => CardLibraryPanel.getState().activeGroupId); await page.getByRole('tab', { name: 'Main', exact: true }).click(); await page.locator('[data-manage-title]').click(); await page.locator('#title-group').selectOption(target); await page.locator('#save-title').click(); await page.waitForFunction(() => !document.getElementById('title-dialog').open); assert.equal(await page.locator('[data-insert-title]').count(), 1); assert.equal(await page.locator('#group-heading').textContent(), '字幕集');
  // A competing metadata edit remains intact, and the current unsaved name is retained for review.
  await page.locator('[data-manage-title]').click(); await page.locator('#title-name').fill('変更中の名前'); await page.evaluate(() => { var state = JSON.parse(localStorage.getItem(CardLibrary.key)); state.titles[0].name = '他の画面で変更'; localStorage.setItem(CardLibrary.key, JSON.stringify(state)); }); await page.locator('#save-title').click(); assert.match(await page.locator('#title-error').textContent(), /別の画面/); assert.equal(await page.locator('#title-name').inputValue(), '変更中の名前'); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(CardLibrary.key)).titles[0].name), '他の画面で変更'); await page.locator('[data-close-dialog="title-dialog"]').click(); await page.reload();
  for (const width of [1120, 420, 384]) {
    await page.setViewportSize({ width, height: 780 }); await page.locator('[data-manage-title]').click();
    assert.equal(await page.evaluate(() => { var d = document.getElementById('title-dialog'); return d.scrollWidth > d.clientWidth + 1; }), false, 'registration does not overflow at ' + width);
    await page.locator('#save-title').scrollIntoViewIfNeeded(); assert.equal(await page.locator('#save-title').isVisible(), true); await page.locator('[data-close-dialog="title-dialog"]').click();
  }
  await page.locator('[data-manage-title]').click(); await page.locator('#delete-title').click(); await page.waitForFunction(() => !document.getElementById('title-dialog').open); assert.equal(await page.locator('[data-insert-title]').count(), 0);
  // Browser-only preview explains the host requirement and never exposes fake insertion.
  const preview = await browser.newPage(); preview.on('pageerror', e => errors.push(e.message)); await preview.goto(url); await preview.locator('#register-title').click(); assert.equal(await preview.locator('#pick-title-template').isDisabled(), true); assert.equal(await preview.locator('#save-title').isDisabled(), true); assert.match(await preview.locator('#title-context-note').textContent(), /Premiere内/);
  assert.deepEqual(errors, []); console.log('Title UI passed: native picker/cancel/errors, preserved-copy quota retry, one-click insertion/locking, reload/search/groups/settings, concurrent-edit protection, unverified/error states and 384px layout. Premiere calls mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
