'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

// Pass a second build's directory with --measure to collect a comparable baseline.
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const measureOnly = process.argv.includes('--measure');
const library = require(path.join(root, 'js/library'));
const base = 'http://127.0.0.1:8123';
const state = library.create(), sample = base + '/examples/media/boss.png';
const project = library.baseProject('cards');
project.cards[0].mediaPath = sample;
project.cards[0].mediaType = 'image';
const source = library.placementFrom(project, project.cards[0].id);
for (let i = 0; i < 200; i++) {
  const label = '素材' + String(i).padStart(3, '0');
  library.savePlacement(state, { ...source, name: label, sourceName: label, mediaPath: sample + '?item=' + i });
}
library.savePreset(state, { name: 'カード', groupId: 'main', project: library.baseProject('cards') });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 860 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(base + '/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) return route.abort();
      return route.fulfill({ path: file });
    });
    await page.addInitScript(({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
      window.previewCallbacks = 0;
      const schedule = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => schedule(time => {
        if (callback.name === 'tick') window.previewCallbacks++;
        callback(time);
      });
    }, { key: library.key, state });
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.CardDiscordUI);
    const tiles = page.locator('#sabu-gallery .sabu-tile, #sabu-picker-gallery .sabu-tile');
    const metrics = { placements: state.assets.length, startupHiddenTiles: await tiles.count() };
    metrics.idleCallbacksInOneSecond = await page.evaluate(async () => {
      const start = window.previewCallbacks;
      await new Promise(resolve => setTimeout(resolve, 1000));
      return window.previewCallbacks - start;
    });
    metrics.searchIndexRebuilds = await page.evaluate(() => {
      const collect = CardMediaLibrary.collect;
      let scans = 0;
      CardMediaLibrary.collect = function (data) { scans++; return collect(data); };
      try {
        function search(id, terms) {
          const input = document.getElementById(id);
          for (const term of terms) { input.value = term; input.dispatchEvent(new Event('input')); }
        }
        search('main-search', ['カ', 'カー', 'カード', '']);
        CardDiscordUI.showView('images');
        search('media-collection-search', ['素', '素材', '素材0', '素材001']);
        return scans;
      } finally { CardMediaLibrary.collect = collect; }
    });
    assert.equal(await page.locator('.media-tile').count(), 1);
    console.log(JSON.stringify(metrics));
    if (!measureOnly) {
      assert.equal(metrics.startupHiddenTiles, 0);
      assert.equal(metrics.idleCallbacksInOneSecond, 0);
      assert.equal(metrics.searchIndexRebuilds, 0);
    }
    await page.locator('.media-tile .preset-open').click();
    await page.locator('#media-preview-manage').click();
    await page.waitForFunction(() => document.getElementById('sabu-dialog').open);
    assert.equal(await page.locator('#sabu-name').inputValue(), '素材001');
    await page.keyboard.press('Escape');
    await page.locator('#sabu-search').fill('素材12');
    assert.equal(await page.locator('[data-sabu-edit]').count(), 10);
    if (!measureOnly) {
      assert.equal(await page.locator('[data-sabu-apply]').count(), 0);
      await page.locator('#sabu-tab').click();
      assert.equal(await tiles.count(), 0);
      await page.locator('#sabu-tab').click();
      assert.equal(await page.locator('[data-sabu-edit]').count(), 10);
    }
    await page.locator('#assets-library-dialog [data-close-dialog="assets-library-dialog"]').click();
    await page.waitForFunction(() => !document.getElementById('assets-library-dialog').open);
    await page.locator('#library-home-button').click();
    await page.locator('[data-open-preset]').click();
    await page.locator('#open-sabu-picker').click();
    await page.locator('#sabu-picker-search').fill('素材199');
    assert.equal(await page.locator('[data-sabu-apply]').count(), 1);
    if (!measureOnly) assert.equal(await page.locator('[data-sabu-edit]').count(), 0);
    await page.evaluate(() => {
      // Simulate a successful edit in another panel while the picker is open.
      const next = CardLibrary.load(localStorage);
      CardLibrary.removePlacement(next, next.assets.find(item => item.name === '素材199').id);
      CardLibrary.save(localStorage, next);
      window.dispatchEvent(new StorageEvent('storage', { key: CardLibrary.key }));
    });
    assert.equal(await page.locator('[data-sabu-apply]').count(), 0);
    await page.locator('#sabu-picker-search').fill('素材198');
    await page.locator('[data-sabu-apply]').click();
    await page.waitForFunction(() => !document.getElementById('sabu-picker-dialog').open);
    assert.equal(await page.evaluate(() => CardPanel.getPlacement().mediaPath.endsWith('?item=198')), true);
    const beforePlayback = await page.evaluate(() => window.previewCallbacks);
    await page.locator('#play').click();
    await page.waitForFunction(time => CardPanel.getTime() > time, await page.evaluate(() => CardPanel.getTime()));
    await page.locator('#play').click();
    assert.ok(await page.evaluate(() => window.previewCallbacks) > beforePlayback);
    const stopped = await page.evaluate(() => CardPanel.getTime());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => CardPanel.getTime()), stopped);
    if (!measureOnly) {
      assert.equal(await tiles.count(), 0);
      const start = await page.evaluate(() => window.previewCallbacks);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.previewCallbacks), start);
      await page.locator('#scrub').evaluate(slider => {
        slider.value = CardPanel.getProject().duration - 0.1;
        slider.dispatchEvent(new Event('input'));
      });
      await page.locator('#play').click();
      await page.waitForFunction(() => CardPanel.getTime() === CardPanel.getProject().duration);
      assert.equal(await page.locator('#play').getAttribute('aria-label'), '再生');
      const end = await page.evaluate(() => window.previewCallbacks);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.previewCallbacks), end);
      await page.locator('#play').click();
      await page.waitForFunction(() => CardPanel.getTime() > 0 && CardPanel.getTime() < 1);
      await page.locator('#close-editor').click();
      await page.locator('#discard-editor').click();
      await page.locator('#open-image-library').click();
      await page.locator('#media-collection-search').fill('素材199');
      assert.equal(await page.locator('.media-tile').count(), 0);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
