/* Real panel + bridge + bundled JSX; only the native Premiere DOM is emulated. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), timelineSource = fs.readFileSync(path.join(root, 'js/timeline-host.jsx'), 'utf8');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const name = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0]));
  if (!name.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(name, (error, body) => { if (error) return response.writeHead(404).end(); response.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream'); response.end(body); });
});
const state = { selected: 1 }, scripts = [], loaded = [];
const clip = { nodeId: 'graphic-1', name: '配信用の字幕・白文字', start: { ticks: '508032000000' }, end: { ticks: '1524096000000' }, disabled: false, isAdjustmentLayer: () => false, projectItem: { isSequence: () => false } };
const sequence = { sequenceID: 'seq-1', name: '編集用 1920×1080', frameSizeHorizontal: 1920, frameSizeVertical: 1080, timebase: '8467200000', getSelection: () => state.selected === 1 ? [clip] : state.selected === 0 ? [] : [clip, clip], videoTracks: { numTracks: 1, 0: { name: 'テロップ', clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } };
let native;
function File(name) { this.fsName = name; }
native = vm.createContext({ app: { version: '26.0', project: { documentID: 'project-1', activeSequence: sequence } }, File, $: { evalFile(file) { const name = path.basename(file.fsName.replace(/\\/g, '/')); assert.ok(['host.jsx', 'timeline-host.jsx'].includes(name)); loaded.push(name); return vm.runInContext(fs.readFileSync(path.join(root, 'js', name), 'utf8'), native); } } });
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, errors = [];
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function open(query = '') {
    const page = await browser.newPage({ viewport: { width: 1120, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('runNativeScript', script => { scripts.push(script); return vm.runInContext(script, native); });
    await page.addInitScript(({ source }) => {
      const params = new URLSearchParams(location.search), preview = params.has('preview');
      const extension = params.has('badroot') ? 'relative' : 'C:/Users/試験 %20/CardReveal';
      window.nativeBehavior = 'normal'; window.nativeRequests = []; window.pendingNative = []; window.failSourceRead = false;
      if (!preview) window.__adobe_cep__ = {
        getSystemPath: () => extension,
        evalScript(script, callback) {
          window.nativeRequests.push(script);
          if (window.nativeBehavior === 'none') { window.pendingNative.push({ script, callback }); return; }
          if (window.nativeBehavior === 'throw') throw Error('native dispatch failed');
          if (window.nativeBehavior === 'empty') { callback(''); return; }
          if (window.nativeBehavior === 'syntax') { callback('EvalScript error.'); return; }
          if (window.nativeBehavior === 'invalid') { callback('invalid JSON'); return; }
          window.runNativeScript(script).then(callback, () => callback('EvalScript error.'));
        }
      };
      const pathAPI = { join: function () { return Array.from(arguments).join('/'); }, isAbsolute: value => /^(?:[A-Za-z]:[\\/]|\/)/.test(value), extname: value => /\.[^./\\]+$/.exec(value)?.[0] || '', sep: '/', delimiter: ';' };
      const requireNode = name => {
        if (name === 'path') return pathAPI;
        if (name === 'url') return { fileURLToPath: value => value.replace(/^file:\/\//, ''), pathToFileURL: value => ({ href: 'file:///' + value }) };
        if (name === 'process') return { env: {}, platform: 'win32' };
        if (name === 'fs') return { readFileSync(filename) { if (window.failSourceRead) throw Error('ENOENT'); if (!filename.endsWith('/js/timeline-host.jsx')) throw Error('Unexpected file read'); return source; } };
        throw Error('Unexpected module: ' + name);
      };
      // Match CEP's mixed context, including module exports used by UMD files.
      window.module = { exports: {} };
      if (!preview && !params.has('nonode')) { window.cep_node = { require: requireNode }; window.require = requireNode; }
    }, { source: timelineSource });
    await page.goto(base + query); return page;
  }
  const page = await open(); await page.clock.install();
  assert.equal(await page.locator('#timeline-trial-check').isVisible(), true, 'connection check is available before opt-in');
  await page.locator('#timeline-trial-check').click(); await page.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('通信は正常'));
  assert.match(await page.locator('#timeline-trial-state').textContent(), /クリップが1件/);
  assert.equal(await page.evaluate(() => CardBridge.getHostStatus().ready), true);
  await page.locator('#timeline-trial-enabled').check();
  await page.locator('#timeline-trial-selection').click(); await page.waitForFunction(() => document.getElementById('timeline-trial-dialog').open);
  assert.equal(await page.locator('#timeline-source-name').textContent(), clip.name); assert.match(await page.locator('#timeline-source-sequence').textContent(), /編集用 1920×1080/);
  assert.ok(scripts.some(script => script.includes('function selectedCandidate()'))); assert.equal(loaded.includes('timeline-host.jsx'), false, 'selection bypasses ExtendScript File/evalFile');
  await page.locator('#timeline-trial-cancel').click();
  state.selected = 0;
  await page.locator('#timeline-trial-selection').click(); await page.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('1つだけ'));
  assert.equal(await page.locator('#timeline-trial-selection').isEnabled(), true); state.selected = 1;
  await page.evaluate(() => window.nativeBehavior = 'none');
  await page.locator('#timeline-trial-selection').click();
  assert.match(await page.locator('#timeline-trial-state').textContent(), /読み込んでいます/); assert.equal(await page.locator('#timeline-trial-selection').isDisabled(), true);
  await page.clock.fastForward(10050); await page.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('CEP_TIMEOUT'));
  assert.equal(await page.locator('#timeline-trial-selection').isEnabled(), true); assert.equal(await page.locator('#timeline-trial-report').isEnabled(), true);
  assert.equal(await page.evaluate(() => CardBridge.getHostStatus().lastRequest.code), 'CEP_TIMEOUT');
  // An old native reply must never reopen a registration after the timeout.
  await page.evaluate(async () => { const old = window.pendingNative.shift(); old.callback(await window.runNativeScript(old.script)); });
  assert.equal(await page.locator('#timeline-trial-dialog').isVisible(), false);
  await page.screenshot({ path: path.join(root, 'examples/panel-connection-timeout.png'), fullPage: true });
  for (const [behavior, code] of [['empty', 'CEP_EMPTY_RESPONSE'], ['syntax', 'CEP_SCRIPT_ERROR'], ['throw', 'CEP_DISPATCH_ERROR'], ['invalid', 'CEP_INVALID_RESPONSE']]) {
    await page.evaluate(value => window.nativeBehavior = value, behavior); await page.locator('#timeline-trial-selection').click();
    await page.waitForFunction(value => document.getElementById('timeline-trial-state').textContent.includes(value), code); assert.equal(await page.locator('#timeline-trial-selection').isEnabled(), true);
  }
  await page.evaluate(() => { window.nativeBehavior = 'normal'; window.failSourceRead = true; });
  const before = await page.evaluate(() => nativeRequests.length); await page.locator('#timeline-trial-selection').click();
  await page.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('CEP_SCRIPT_MISSING')); assert.equal(await page.evaluate(() => nativeRequests.length), before);
  await page.evaluate(() => window.failSourceRead = false);
  await page.locator('#timeline-trial-check').click(); await page.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('通信は正常'));
  await page.screenshot({ path: path.join(root, 'examples/panel-connection-check.png'), fullPage: true });
  for (const width of [420, 384]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.locator('#timeline-trial-check').isVisible(), true); }
  for (const query of ['?nonode=1', '?badroot=1']) {
    const broken = await open(query); assert.equal(await broken.locator('#timeline-trial-enabled').isDisabled(), true); assert.ok((await broken.locator('#timeline-trial-state').textContent()).length > 10);
    assert.equal(await broken.locator('#timeline-trial-report').isVisible(), true);
    await broken.locator('#timeline-trial-check').click(); await broken.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('通信は正常'));
    assert.equal(await broken.evaluate(() => CardBridge.getHostStatus().ready), false); assert.match(await broken.locator('#timeline-trial-state').textContent(), /初期化|Node.js/); await broken.close();
  }
  const preview = await open('?preview=1');
  assert.match(await preview.locator('#timeline-trial-state').textContent(), /Premiereとの接続がありません/);
  await preview.locator('#timeline-trial-check').click(); await preview.waitForFunction(() => document.getElementById('timeline-trial-state').textContent.includes('CEP_UNAVAILABLE'));
  const downloadPromise = preview.waitForEvent('download'); await preview.locator('#timeline-trial-report').click(); const download = await downloadPromise;
  const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8')); assert.equal(report.environment.cepAvailable, false); assert.equal(report.last.code, 'CEP_UNAVAILABLE');
  assert.equal(JSON.stringify(report).includes('C:/Users/'), false); await preview.close();
  assert.deepEqual(errors, []);
  console.log('Connection UI passed through real bridge and bundled JSX: native probe/selection, startup errors, 10s timeout + late-reply rejection, dispatch/script/empty/missing-file errors, readable diagnostics and 384px controls. Premiere DOM emulated.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
