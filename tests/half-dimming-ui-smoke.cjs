'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { encodePNG } = require('../js/highlight');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

(async () => {
  const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox'] });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(7000);
    const base = 'http://127.0.0.1:8129';
    const image = Buffer.alloc(160 * 160 * 4);
    for (let i = 0; i < image.length; i += 4) {
      const x = (i / 4) % 160;
      image.set([200,140,90,x < 48 ? 255 : x < 96 ? 128 : 0], i);
    }
    const fixture = encodePNG({width:160,height:160,pixels:image});
    await page.route(base + '/**', route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/fixture.png') return route.fulfill({contentType:'image/png',body:fixture});
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
      return route.fulfill({path:file});
    });
    const ui = s => page.locator(s);
    const state = () => page.evaluate(() => CardPanel.getProject());
    const pixel = (x, y) => page.evaluate(([x,y]) => [...document.querySelector('#preview').getContext('2d').getImageData(x,y,1,1).data], [x,y]);
    const seek = async time => {
      await ui('#dim-time').fill(String(time));
      await ui('#dim-time').press('Tab');
    };
    function compare(actual, normal, gain) {
      assert.equal(actual[3], normal[3]);
      if (normal[3]) normal.slice(0,3).forEach((c,i) => assert.ok(Math.abs(actual[i] - c * gain) < 4, [actual, normal, gain]));
    }
    await page.goto(base + '/index.html');
    await ui('#toggle-template-panel').click();
    await ui('#template-half').click();
    await page.evaluate(url => {
      const p = CardPanel.getProject();
      Object.assign(p, {width:320, height:160, fps:20, duration:2});
      Object.assign(p.half, {slideDuration:0.1, interval:0});
      p.cards.forEach((card, i) => Object.assign(card, {x:80 + 160 * i, y:80}));
      Object.assign(p.cards[0], {mediaPath:url, mediaType:'image'});
      delete p.half.dimming; // Opening a v0.19.0 preset.
      CardPanel.setProject(p);
    }, base + '/fixture.png');
    await page.waitForFunction(() => document.querySelector('[data-thumb] img')?.naturalWidth === 160 && !CardPanel.isMediaPending());
    const left = await pixel(20,80), feather = await pixel(75,80), right = await pixel(220,80), seam = await pixel(160,80);
    assert.equal(left[3], 255);
    assert.equal(feather[3], 128);
    assert.equal((await pixel(115,80))[3], 0);
    await ui('#dim-initial').check();
    compare(await pixel(20,80), left, 0.4);
    compare(await pixel(75,80), feather, 0.4);
    compare(await pixel(220,80), right, 1);
    compare(await pixel(160,80), seam, 1);
    await ui('#dim-amount').focus();
    await ui('#dim-amount').press('End');
    compare(await pixel(75,80), feather, 0);
    assert.equal((await pixel(115,80))[3], 0);
    await ui('#dim-timing summary').click();
    await ui('#dim-fade').fill('0.2');
    await seek(1);
    await ui('#dim-light').click();
    await ui('[data-dim-side="1"]').click();
    await ui('#dim-fade').fill('0.2');
    await ui('#dim-fade').press('Tab');
    await ui('#dim-dark').click();
    await ui('#dim-light').click();
    assert.deepEqual((await state()).half.dimming[1].cues, [{time:1,dark:false}]);
    await ui('#undo-edit').click();
    assert.deepEqual((await state()).half.dimming[1].cues, [{time:1,dark:true}]);
    await ui('[data-remove]').click();
    assert.equal((await state()).half.dimming[1].cues.length, 0);
    await ui('#undo-edit').click();
    for (const [time,a,b] of [[0.9,0,1],[1.1,0.5,0.7],[1.3,1,0.4]]) {
      await seek(time);
      compare(await pixel(20,80), left, a);
      compare(await pixel(220,80), right, b);
      compare(await pixel(75,80), feather, a);
      compare(await pixel(160,80), seam, 1);
    }
    await ui('[data-jump]').click();
    assert.equal(await page.evaluate(() => CardPanel.getTime()), 1);
    await ui('#save-to-group').click();
    await ui('#preset-name').fill('話者に合わせて暗転');
    await ui('#save-preset').click();
    await page.waitForFunction(() => !document.querySelector('#editor-dialog').open);
    await page.reload();
    await page.getByRole('button', {name:'話者に合わせて暗転を編集',exact:true}).click();
    assert.deepEqual((await state()).half.dimming.map(s => [s.initial,s.amount,s.cues[0].dark]), [[true,100,false],[false,60,true]]);
    await page.setViewportSize({width:320,height:360});
    await ui('#tab-settings').click();
    await ui('#half-layout').selectOption('rows');
    assert.deepEqual(await ui('[data-dim-side]').allTextContents(), ['上','下']);
    await ui('[data-dim-side="1"]').click();
    assert.equal(await ui('[data-dim-side="1"]').getAttribute('aria-pressed'), 'true');
    assert.ok(await ui('#half-dim').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert.deepEqual(errors, []);
    console.log('Independent dimming, translucent preview pixels, fades, cues, undo, saved presets and compact upper/lower selection passed.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
