'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), { execFileSync } = require('node:child_process');
const { chromium } = require('playwright'), Lib = require('../js/library'), Model = require('../js/model');
const root = path.resolve(__dirname, '..'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'card-channels-')), clip = path.join(scratch, 'intro.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x5865f2:s=320x180:r=10:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', clip]);
const server = http.createServer((request, response) => {
 const route = request.url.split('?')[0], filename = route === '/intro.mp4' ? clip : path.resolve(root, '.' + (route === '/' ? '/index.html' : decodeURIComponent(route)));
 if (filename !== clip && !filename.startsWith(root + path.sep)) return response.writeHead(403).end();
 fs.readFile(filename, (error, body) => { if (error) return response.writeHead(404).end(); response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4' }[path.extname(filename)] || 'application/octet-stream'); response.end(body); });
});
let browser;
(async () => {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
 const state = Lib.create(), cards = Model.createProject();
 Object.assign(cards.cards[0], { mediaPath: base + '/examples/media/boss.png', mediaType: 'image', name: 'ボス画像' });
 Object.assign(cards.cards[1], { mediaPath: base + '/examples/media/treasure.png', mediaType: 'image', name: '宝箱画像' });
 Object.assign(cards.cards[2], { mediaPath: base + '/intro.mp4', mediaType: 'video', name: '紹介動画' });
 Lib.savePreset(state, { name: 'ボス紹介', groupId: 'main', project: cards }); const frame = Lib.baseProject('highlight'); Object.assign(frame.cards[0], cards.cards[0]); Lib.savePreset(state, { name: '画像の外周を強調', groupId: 'main', project: frame });
 for (const [i, name] of [[0, 'ボスの配置'], [1, '宝箱の配置'], [2, '紹介動画の配置']]) Lib.savePlacement(state, { ...Lib.placementFrom(cards, cards.cards[i].id), name });
 Lib.saveTitle(state, { name: '以前のテキスト', groupId: 'main', videoTrack: 'auto', templatePath: 'C:/old/template.mogrt' });
 browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
 const page = await browser.newPage({ viewport: { width: 1120, height: 900 } }), errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
 await page.addInitScript(({ key, value }) => localStorage.getItem(key) === null && localStorage.setItem(key, JSON.stringify(value)), { key: Lib.key, value: state }); await page.goto(base);
 assert.equal(await page.locator('.category-rail button').count(), 3); assert.equal(await page.locator('#plugin-sidebar [data-library-view]').count(), 2);
 assert.deepEqual(await page.locator('#plugin-sidebar [data-library-view]>span:first-of-type').allTextContents(), ['元素材', '作成済みの素材']);
 assert.equal(await page.locator('#title-dialog,#timeline-trial-dialog,#register-title,[data-insert-title],[data-library-view="all"],[data-library-view="titles"]').count(), 0);
 const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src'))); assert.equal(scripts.some(src => /(?:titles-panel|title-drop|timeline-trial-panel)/.test(src)), false);
 // Build real saved thumbnails through the editor, keeping the existing media.
 for (const label of ['ボス紹介', '画像の外周を強調']) {
  await page.getByRole('button', { name: label + 'を編集', exact: true }).click(); await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-thumb] img')).length && Array.from(document.querySelectorAll('[data-thumb] img')).every(image => image.complete && image.naturalWidth));
  await page.locator('#scrub').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); }); await page.locator('#save-to-group').click(); await page.locator('#close-editor').click();
 }
 let original = await page.evaluate(() => CardLibraryPanel.getState());
 await page.screenshot({ path: path.join(root, 'examples/panel-channels-plugins.png') });
 await page.locator('#toggle-template-panel').click(); assert.equal(await page.locator('#workspace-title').textContent(), '元素材'); assert.equal(await page.locator('[data-template-mode]').count(), 3); await page.screenshot({ path: path.join(root, 'examples/panel-channels-originals.png') });
 await page.locator('#template-cards').click(); assert.equal(await page.locator('#editor-dialog').isVisible(), true); await page.locator('#close-editor').click(); assert.equal(await page.locator('#workspace-title').textContent(), '作成済みの素材');
 async function data() { return page.evaluate(() => CardLibraryPanel.getState()); }
 async function groupId(kind, name) { return (await data()).mediaGroups[kind].groups.find(group => group.name === name).id; }
 async function addGroup(name) { await page.locator('#add-media-group').click(); await page.locator('#media-group-name').fill(name); await page.locator('#confirm-media-group').click(); await page.waitForFunction(() => !document.getElementById('media-group-dialog').open); }
 await page.locator('#open-image-library').click(); assert.equal(await page.locator('.media-tile').count(), 2); await addGroup('# サムネイル'); await addGroup('説明画像'); assert.equal(await page.locator('.media-tile').count(), 0);
 assert.equal((await data()).mediaGroups.image.groups.length, 3); assert.equal((await data()).mediaGroups.video.groups.length, 1);
 await page.getByRole('tab', { name: '未分類', exact: true }).click(); await page.getByRole('button', { name: 'ボス画像のグループを変更', exact: true }).click(); await page.locator('#media-move-target').selectOption(await groupId('image', 'サムネイル'));
 // Storage failure keeps both the committed folder and move dialog unchanged.
 const beforeQuota = await data(); await page.evaluate(() => { window.oldStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
 await page.locator('#confirm-media-move').click(); assert.match(await page.locator('#media-move-error').textContent(), /保存容量/); assert.deepEqual(await data(), beforeQuota); await page.evaluate(() => Storage.prototype.setItem = window.oldStorageSet); await page.locator('#confirm-media-move').click(); await page.waitForFunction(() => !document.getElementById('media-move-dialog').open);
 assert.equal(await page.locator('.media-tile').count(), 1); await page.getByRole('tab', { name: 'サムネイル', exact: true }).click(); assert.equal(await page.locator('.media-tile').count(), 1);
 await page.reload(); await page.locator('#open-image-library').click(); assert.equal(await page.locator('#media-collection-title').textContent(), '# サムネイル'); assert.equal(await page.locator('.media-tile').count(), 1);
 await page.locator('#rename-media-group').click(); await page.locator('#media-group-name').fill('説明画像'); await page.locator('#confirm-media-group').click(); assert.match(await page.locator('#media-group-error').textContent(), /同じ名前/); await page.locator('#media-group-name').fill('サムネ用'); await page.locator('#confirm-media-group').click(); await page.waitForFunction(() => !document.getElementById('media-group-dialog').open);
 assert.equal(await page.locator('#media-collection-title').textContent(), '# サムネ用'); await page.waitForFunction(() => document.querySelector('.media-tile img')?.naturalWidth > 0); await page.screenshot({ path: path.join(root, 'examples/panel-channels-images.png') });
 await page.keyboard.press('Control+f'); assert.equal(await page.locator('#media-collection-search').evaluate(el => el === document.activeElement), true); await page.locator('#media-collection-search').fill('不存在'); assert.equal(await page.locator('.media-tile').count(), 0); await page.keyboard.press('Escape');
 await page.locator('.media-tile .preset-open').click(); await page.waitForFunction(() => document.getElementById('media-preview-image').naturalWidth > 0); assert.equal(await page.locator('#media-preview-path').inputValue(), cards.cards[0].mediaPath); await page.keyboard.press('Escape');
 await page.locator('#delete-media-group').click(); assert.equal((await data()).mediaGroups.image.groups.length, 2); assert.equal(await page.locator('.media-tile').count(), 2);
 await page.locator('#open-video-library').click(); assert.equal(await page.locator('#delete-media-group').isDisabled(), true); await addGroup('オープニング'); await page.getByRole('tab', { name: '未分類', exact: true }).click(); await page.getByRole('button', { name: '紹介動画のグループを変更', exact: true }).click(); await page.locator('#media-move-target').selectOption(await groupId('video', 'オープニング')); await page.locator('#confirm-media-move').click(); await page.getByRole('tab', { name: 'オープニング', exact: true }).click();
 await page.screenshot({ path: path.join(root, 'examples/panel-channels-videos.png') }); await page.locator('.media-tile .preset-open').click(); await page.waitForFunction(() => document.getElementById('media-preview-video').videoWidth === 320); assert.equal(await page.locator('#media-preview-video').evaluate(el => el.muted && el.paused), true); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('media-preview-video').hasAttribute('src'));
 const afterGroups = await data(); assert.deepEqual(afterGroups.presets, original.presets); assert.deepEqual(afterGroups.assets, original.assets); assert.deepEqual(afterGroups.titles, original.titles);
 // A move stays bound to its reviewed source if another window changes it.
 await page.getByRole('button', { name: '紹介動画のグループを変更', exact: true }).click(); await page.locator('#media-move-target').selectOption((await data()).mediaGroups.video.groups[0].id);
 await page.evaluate(() => CardLibraryPanel.commit(state => CardMediaGroups.assign(state, 'video', [state.assets.find(asset => asset.mediaType === 'video').mediaPath], state.mediaGroups.video.groups[0].id))); const concurrent = await data(); await page.locator('#confirm-media-move').click(); assert.match(await page.locator('#media-move-error').textContent(), /別の画面/); assert.deepEqual(await data(), concurrent); await page.locator('[data-close-dialog="media-move-dialog"]').click();
 await page.locator('#library-home-button').click(); await page.locator('#toggle-template-panel').click(); await page.locator('#template-cards').click(); await page.locator('#save-to-group').click(); await page.locator('#preset-name').fill('以前のテキスト'); await page.locator('#save-preset').click(); await page.waitForFunction(() => !document.getElementById('editor-dialog').open); assert.equal((await data()).presets.some(item => item.name === '以前のテキスト'), true); assert.deepEqual((await data()).titles, original.titles);
 for (const width of [1120, 760, 420, 384]) {
  await page.setViewportSize({ width, height: 900 }); await page.locator('#open-image-library').click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.locator('.category-rail button').count(), 3);
  if (width <= 760) { await page.locator('#toggle-channel-sidebar').click(); assert.equal(await page.locator('#media-group-tabs').isVisible(), true); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('channels-drawer').open); }
 }
 await page.locator('#toggle-channel-sidebar').click(); await page.screenshot({ path: path.join(root, 'examples/panel-channels-narrow.png') }); await page.keyboard.press('Escape');
 await page.setViewportSize({ width: 1120, height: 900 }); await page.locator('#library-home-button').click(); await page.getByRole('button', { name: '画像の外周を強調を編集', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-thumb] img')?.naturalWidth > 0); await page.screenshot({ path: path.join(root, 'examples/panel-channels-editor.png') });
 assert.deepEqual(errors, []); console.log('Channel UI passed: title/all-save UI removed, three sections, original/saved plugins, independent image/video groups + move/rename/delete/reload, quota and concurrent-move protection, real media previews, unchanged old records and 1120–384px layout.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); fs.rmSync(scratch, { recursive: true, force: true }); });
