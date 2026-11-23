'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'card-drop-'));
const image = path.join(scratch, 'ボス # 100%.png'), video = path.join(scratch, '紹介.mp4'), text = path.join(scratch, 'メモ.txt');
fs.copyFileSync(path.join(root, 'examples/media/boss.png'), image);
fs.writeFileSync(text, 'メモ');
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
const fixtures = [image, video, text];
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const fixture = /^\/fixture\/([0-2])$/.exec(pathname);
  const file = fixture ? fixtures[Number(fixture[1])] : path.resolve(root, '.' + pathname);
  if (!fixture && !file.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return response.writeHead(404).end();
    response.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.mp4':'video/mp4'})[path.extname(file)] || 'text/plain');
    response.end(bytes);
  });
});
let browser;

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1120, height: 830 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(5000);
  // Chrome supplies the actual OS FileList through CDP. Only the CEP-specific path and Node bridge are simulated.
  const localFiles = fixtures.map((p,i) => ({ name: path.basename(p), path: p, href: base + '/fixture/' + i }));
  await page.addInitScript(({ files, root }) => {
    Object.defineProperty(File.prototype, 'path', { get() { return window.hideNativePath ? '' : (files.find(f => f.name === this.name) || {}).path; } });
    const modules = {
      path: { isAbsolute: p => typeof p === 'string' && p.startsWith('/'), normalize: p => p, basename: p => p.split('/').pop() },
      fs: { statSync: p => ({ isFile: () => files.some(f => f.path === p) }) },
      url: { pathToFileURL: p => { const f = files.find(f => f.path === p); return f || new URL(p, location.href); },
        fileURLToPath: u => decodeURIComponent(new URL(u).pathname) }, process: { env: {} }
    };
    window.cep_node = { require: k => modules[k] };
    window.__adobe_cep__ = { getSystemPath: () => root, evalScript: () => { throw new Error('Unexpected host call'); } };
  }, { files: localFiles, root });
  const url = base + '/index.html';
  await page.goto(url); await page.waitForFunction(() => window.CardDiscordUI && CardBridge.hasHost);
  const cdp = await page.context().newCDPSession(page);
  async function drop(target, files, screenshot) {
    await target.scrollIntoViewIfNeeded();
    const rect = await target.boundingBox();
    const data = { items: [], files, dragOperationsMask: 1 };
    const position = { x: rect.x + rect.width / 2, y: Math.min(rect.y + rect.height / 2, (await page.viewportSize()).height - 15) };
    for (const type of ['dragEnter','dragOver','drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, ...position, data });
      if (type === 'dragOver' && screenshot) {
        assert.ok(await page.locator('.file-drag-over').count() > 0);
        await page.screenshot({ path: path.join(root, 'examples', screenshot) });
      }
    }
  }
  const state = () => page.evaluate(() => CardLibraryPanel.getState());
  const stored = () => page.evaluate(() => localStorage.getItem(CardLibrary.key));
  const project = () => page.evaluate(() => CardPanel.getProject());
  const xButton = page.locator('#group-actions-dialog .group-close');
  async function newGroup(kind, name) {
    const media = kind !== 'plugin';
    await page.locator(media ? '#add-media-group' : '#add-group').click();
    await page.locator(media ? '#media-group-name' : '#group-name').fill(name);
    await page.locator(media ? '#confirm-media-group' : '#confirm-group').click();
  }
  // Right-clicking an inactive group must not switch, rename or delete the current group on cancel.
  await newGroup('plugin', '実況');
  const main = page.getByRole('tab', { name:'Main', exact:true });
  const initial = await stored();
  await main.click({button:'right'}); assert.equal(await page.locator('#group-action-title').textContent(), 'Main');
  await xButton.click(); assert.equal(await stored(), initial);
  await main.click({button:'right'}); await page.locator('#group-action-rename').click(); await page.locator('#group-action-name').fill('変更中');
  await xButton.click(); assert.equal(await stored(), initial);
  await main.click({button:'right'}); await page.locator('#group-action-delete').click(); await xButton.click(); assert.equal(await stored(), initial);
  await main.focus(); await page.keyboard.press('Shift+F10'); await page.locator('#group-action-rename').click();
  await page.locator('#group-action-name').fill('共通'); await page.locator('#group-action-apply').click();
  assert.equal((await state()).groups.find(g => g.id === 'main').name, '共通');
  assert.equal(await page.locator('#group-heading').textContent(), '実況');

  await page.locator('#open-video-library').click(); await newGroup('video', 'オープニング');
  await page.locator('#open-image-library').click(); await newGroup('image', '立ち絵');
  const gallery = page.locator('#media-collection-empty');
  const empty = await stored();
  await drop(gallery, [image, text]); assert.equal(await stored(), empty); assert.match(await page.locator('#media-import-status').textContent(), /対象外/);
  await page.evaluate(() => { window.storageSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await drop(gallery, [image, video]); assert.equal(await stored(), empty); assert.match(await page.locator('#media-import-status').textContent(), /容量/);
  await page.evaluate(() => Storage.prototype.setItem = window.storageSet);
  // Another panel can delete the visible target before its storage event reaches this panel.
  await page.evaluate(() => {
    const latest=JSON.parse(localStorage.getItem(CardLibrary.key));
    CardMediaGroups.remove(latest,'image',latest.mediaGroups.image.activeGroupId);
    localStorage.setItem(CardLibrary.key,JSON.stringify(latest));
  });
  const withoutGroup=await stored(); await drop(gallery, [image,video]);
  assert.equal(await stored(),withoutGroup); assert.match(await page.locator('#media-import-status').textContent(),/登録先/);
  await page.evaluate(value=>localStorage.setItem(CardLibrary.key,value),empty);
  await drop(gallery, [image, video]);
  let saved = await state();
  assert.deepEqual(saved.assets.map(a => a.mediaPath), [image, video]);
  for (const [type, source] of [['image', image], ['video',video]]) {
    assert.equal(saved.mediaGroups[type].assignments.find(a => a.mediaPath === source).groupId, saved.mediaGroups[type].activeGroupId);
  }
  assert.match(await page.locator('#media-import-status').textContent(), /画像1件.*立ち絵.*動画1件.*オープニング/);
  await page.waitForFunction(() => document.querySelector('.media-tile img')?.naturalWidth > 0);
  await page.getByRole('tab', {name:'立ち絵',exact:true}).click({button:'right'});
  await page.screenshot({ path: path.join(root,'examples/panel-group-actions.png') });
  await xButton.click();
  await page.reload(); await page.locator('#open-video-library').click(); assert.match(await page.locator('#media-collection-title').textContent(), /オープニング/);
  await page.locator('.media-tile .preset-open').click();
  await page.waitForFunction(() => document.getElementById('media-preview-video').videoWidth === 160);
  await page.keyboard.press('Escape');

  // The screenshot's plus accepts exactly one file. An assigned card can be replaced and undone.
  await page.locator('#library-home-button').click(); await page.locator('#toggle-template-panel').click(); await page.locator('#template-cards').click();
  const thumbs = page.locator('[data-thumb]'), second = thumbs.nth(1), before = await project();
  await drop(second, [image], 'panel-card-drop.png');
  await page.waitForFunction(() => !CardPanel.isMediaPending() && document.querySelectorAll('[data-thumb]')[1].querySelector('img')?.naturalWidth > 0);
  let current = await project(); assert.equal(current.cards[1].mediaPath, image); assert.deepEqual(current.cards[0], before.cards[0]);
  assert.equal(current.cards[1].flipAt,before.cards[1].flipAt);
  await drop(second, [image,video]); assert.deepEqual(await project(), current); assert.match(await page.locator('#editor-status').textContent(), /1ファイル/);
  await drop(second, [video]); await page.waitForFunction(() => !CardPanel.isMediaPending()); assert.equal((await project()).cards[1].mediaType,'video');
  await page.locator('#undo-edit').click(); assert.equal((await project()).cards[1].mediaPath,image);
  await page.locator('#redo-edit').click(); assert.equal((await project()).cards[1].mediaPath,video);
  await page.evaluate(() => window.hideNativePath = true);
  await drop(second,[image]); assert.equal((await project()).cards[1].mediaPath,video); assert.match(await page.locator('#editor-status').textContent(), /場所/);
  await page.evaluate(() => window.hideNativePath = false);
  await page.locator('#save-to-group').click(); await page.locator('#preset-name').fill('カードの差し替え'); await page.locator('#save-preset').click();
  assert.equal((await state()).presets[0].project.cards[1].mediaPath,video);

  await page.locator('#open-assets-library').click();
  await drop(page.locator('#assets-library-heading'), [image, video]); assert.equal((await state()).assets.length,2);
  await page.locator('#add-sabu').click(); await drop(page.locator('#sabu-preview'),[image]); await page.waitForFunction(() => !document.getElementById('save-sabu').disabled);
  await page.locator('#sabu-name').fill('立ち絵・右寄せ'); await page.locator('#sabu-x').fill('42'); await page.locator('#save-sabu').click();
  await drop(page.locator('#assets-library-heading'), [image]); saved=await state(); assert.equal(saved.assets.length,3); assert.equal(saved.assets.find(a => a.name==='立ち絵・右寄せ').mediaX,42);
  await page.locator('[data-close-dialog="assets-library-dialog"]').click(); await page.reload();
  assert.equal((await state()).assets.find(a => a.name==='立ち絵・右寄せ').mediaX,42);
  await page.setViewportSize({width:420,height:700}); await page.locator('#open-image-library').click(); await page.locator('#toggle-channel-sidebar').click();
  await page.getByRole('tab',{name:'未分類',exact:true}).click({button:'right'});
  const bounds=await page.locator('#group-actions-dialog').boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=420);
  await page.locator('#group-action-rename').click();
  await page.evaluate(() => CardLibraryPanel.commit(s => CardMediaGroups.rename(s,'image','image-ungrouped','外部で変更')));
  await page.locator('#group-action-name').fill('上書き'); await page.locator('#group-action-apply').click(); assert.match(await page.locator('#group-action-error').textContent(),/別の画面/);
  await xButton.click(); assert.ok(await page.locator('#channels-drawer').isVisible());
  await page.getByRole('tab',{name:'外部で変更',exact:true}).click({button:'right'}); await page.locator('#group-action-delete').click(); await page.locator('#group-action-apply').click();
  saved=await state(); assert.deepEqual(saved.mediaGroups.image.groups.map(g=>g.name),['立ち絵']); assert.equal(saved.mediaGroups.video.groups.length,2);
  assert.deepEqual(errors,[]);
  console.log('File-drop UI passed: OS FileList, card replacement/undo/save, grouped image+video batches, placement registration, reload, quota/invalid input, contextual rename/delete/cancel and narrow drawer.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();fs.rmSync(scratch,{recursive:true,force:true});});
