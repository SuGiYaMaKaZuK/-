'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), url = require('node:url'), vm = require('node:vm');
const Lib = require('../js/library'), Model = require('../js/model');
const hostSource = fs.readFileSync(path.join(__dirname, '../js/host.jsx'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(__dirname, '../js/bridge.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const title = (state, options = {}) => Lib.saveTitle(state, { name: 'いつもの字幕', groupId: 'main', templatePath: 'C:/利用者/100%/字幕.mogrt', videoTrack: 'auto', sourceName: '字幕.mogrt', ...options });

test('title library upgrades existing data without rewriting projects or storage', () => {
  const state = Lib.create(); delete state.titles;
  Lib.savePreset(state, { name: 'Cards', groupId: 'main', project: Model.createProject() });
  const raw = JSON.stringify(state), storage = { getItem: () => raw, setItem: () => { throw Error('unexpected write'); } };
  const loaded = Lib.load(storage); assert.deepEqual(loaded.titles, []); assert.deepEqual(loaded.presets, state.presets);
  const saved = title(loaded); assert.deepEqual(Object.keys(saved).sort(), ['groupId', 'id', 'name', 'sourceName', 'templatePath', 'videoTrack'].sort());
  assert.equal(saved.project, undefined); assert.deepEqual(loaded.presets, state.presets);
});
test('titles and effects share group names safely, including moves and group deletion', () => {
  const state = Lib.create(), first = title(state), project = Model.createProject();
  assert.throws(() => Lib.savePreset(state, { name: first.name, groupId: 'main', project }), /同じ名前/);
  Lib.savePreset(state, { name: 'Cards', groupId: 'main', project });
  assert.throws(() => title(state, { name: 'Cards' }), /同じ名前/);
  assert.throws(() => Lib.editPreset(state, state.presets[0].id, first.name, 'main'), /同じ名前/);
  const group = Lib.addGroup(state, 'ボス戦'), second = title(state, { groupId: group.id });
  Lib.removeGroup(state, group.id, 'main');
  assert.equal(state.titles.find(t => t.id === second.id).name, 'いつもの字幕 (2)');
  assert.equal(state.titles.find(t => t.id === second.id).templatePath, first.templatePath);
  const before = clone(state.presets); Lib.removeTitle(state, first.id); assert.deepEqual(state.presets, before);
  assert.throws(() => Lib.saveTitle(state, { ...first }), /見つかりません/);
});
test('invalid title paths and track indexes cannot contaminate saved records', () => {
  const state = Lib.create(), saved = title(state), before = clone(state);
  for (const templatePath of ['relative.mogrt', 'https://example.com/text.mogrt', 'C:/text.mov', 'C:/bad\nfile.mogrt']) {
    assert.throws(() => title(state, { id: saved.id, templatePath })); assert.deepEqual(state, before);
  }
  for (const videoTrack of [-1, 1.5, 1000, 'V1', null]) { assert.throws(() => title(state, { id: saved.id, videoTrack })); assert.deepEqual(state, before); }
  for (const templatePath of ['C:\\日本語\\100%20\\字幕.MOGRT', '\\\\server\\共有\\字幕.mogrt', '/tmp/字幕.mogrt']) assert.doesNotThrow(() => Lib.validateTitle({ templatePath, videoTrack: 0 }));
  const updated = title(state, { id: saved.id, name: '変更後', videoTrack: 2 }); assert.equal(updated.id, saved.id); assert.equal(state.titles.length, 1);
});

function track(options = {}) {
  const clips = { numItems: (options.ends || []).length };
  (options.ends || []).forEach((end, i) => { clips[i] = { end: { ticks: end } }; });
  return { name: options.name || 'トラック', clips, isLocked: () => options.locked || false, isMuted: () => options.muted || false };
}
function tracks(list) { return Object.assign({ numTracks: list.length }, list); }
function hostSetup(options = {}) {
  const calls = [], selections = [], ticks = options.ticks || '900719925474099312345';
  const item = options.item || { start: { ticks }, end: { ticks: '900719925474099999999' }, setSelected: (...args) => selections.push(args) };
  const sequence = {
    name: '紹介 "字幕"', videoTracks: tracks(options.video || [track(), track()]), audioTracks: tracks(options.audio || [track()]),
    getPlayerPosition: () => ({ ticks }), getSelection: () => [{ setSelected: (...args) => selections.push(args) }],
    importMGT: (...args) => { calls.push(args); if (options.importError) throw Error(options.importError); return options.importNull ? null : item; }
  };
  if (options.noAPI) delete sequence.importMGT;
  function File(filePath) { this.fsName = filePath; this.exists = options.exists !== false; }
  File.openDialog = () => options.cancel ? null : { fsName: 'C:/素材/字幕 "白".mogrt' };
  const context = vm.createContext({ File, Folder: function () {}, app: { project: options.noProject ? null : { activeSequence: options.noSequence ? null : sequence } } });
  vm.runInContext(hostSource, context);
  return { api: context.CardReveal, calls, selections, ticks, sequence, insert: (target = 'auto') => JSON.parse(context.CardReveal.insertTitle('C:/素材/字幕 "白".mogrt', target)) };
}
test('host imports the unmodified template once at exact string ticks on safe tracks', () => {
  const env = hostSetup({ video: [track(), track({ locked: true }), track({ ends: ['900719925474099312346'] }), track({ muted: true })], audio: [track(), track({ ends: ['999999999999999999999'] })] });
  const result = env.insert(); assert.equal(result.ok, true); assert.equal(result.verified, true);
  assert.deepEqual(env.calls, [['C:/素材/字幕 "白".mogrt', env.ticks, 0, 0]]);
  assert.equal(typeof env.calls[0][1], 'string'); assert.equal(result.startTicks, env.ticks);
  assert.deepEqual(env.selections, [[0, 0], [1, 1]]);
  const auto = hostSetup(); assert.equal(auto.insert().videoTrack, 1, 'auto uses the highest safe existing track');
  assert.equal(hostSetup().insert(0).videoTrack, 0, 'explicit tracks remain zero based in the API');
});
test('host refuses unsafe or missing tracks before importing, including future audio clips', () => {
  const cases = [
    [{ video: [track({ ends: ['900719925474099312346'] })] }, 'auto'],
    [{ video: [track({ locked: true })] }, 0], [{ video: [track({ muted: true })] }, 0],
    [{ audio: [track({ ends: ['999999999999999999999'] })] }, 'auto'],
    [{ audio: [] }, 'auto'], [{ video: [] }, 'auto'], [{}, 4], [{}, -1], [{}, 0.5], [{}, '0']
  ];
  for (const [options, target] of cases) { const env = hostSetup(options); assert.equal(env.insert(target).ok, false); assert.equal(env.calls.length, 0); }
  const atEnd = hostSetup({ video: [track({ ends: ['900719925474099312345'] })] }); assert.equal(atEnd.insert().ok, true, 'clips ending at CTI are untouched');
  const corrupted = track(); corrupted.clips.numItems = NaN; const env = hostSetup({ video: [corrupted] }); assert.equal(env.insert().ok, false); assert.equal(env.calls.length, 0);
});
test('host handles missing sequences/files/API and unverified results without false completion', () => {
  for (const options of [{ noProject: true }, { noSequence: true }, { exists: false }, { noAPI: true }, { ticks: 'NaN' }]) {
    const env = hostSetup(options); assert.equal(env.insert().ok, false); assert.equal(env.calls.length, 0);
  }
  for (const options of [{ importNull: true }, { importError: '挿入失敗 "字幕"' }]) { const env = hostSetup(options); assert.equal(env.insert().ok, false); assert.equal(env.calls.length, 1); }
  const uncertain = hostSetup({ item: { start: { ticks: '1' }, end: { ticks: '2' } } }); assert.equal(uncertain.insert().verified, false); assert.equal(uncertain.calls.length, 1);
  assert.equal(JSON.parse(hostSetup({ noSequence: true }).api.titleContext()).sequenceName, null);
  const context = JSON.parse(hostSetup().api.titleContext()); assert.equal(context.videoTracks.length, 2); assert.equal(context.sequenceName, '紹介 "字幕"');
  assert.equal(JSON.parse(hostSetup({ cancel: true }).api.pickTitleTemplate()), null);
});

function bridgeSetup(options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'title-bridge-'));
  const root = path.join(folder, '拡張 100%20 "字幕"\u2028'), userData = path.join(folder, '利用者 100%20');
  const source = path.join(folder, 'いつもの "字幕".mogrt'), binary = Buffer.from([0x50, 0x4b, 0, 255, 200, 10, 13, 0, 75]); fs.writeFileSync(source, binary);
  const calls = [], deferred = [];
  const methods = Object.assign({
    pickTitleTemplate: () => JSON.stringify(source),
    titleContext: () => JSON.stringify({ ok: true, sequenceName: '字幕', videoTracks: [{ index: 0, name: 'V1' }] }),
    insertTitle: (...args) => { calls.push(args); return JSON.stringify({ ok: true, inserted: true, verified: true, videoTrack: 0, startTicks: '900719925474099312345' }); },
    pickOutput: () => 'null'
  }, options.host);
  const nodeRequire = name => {
    if (name === 'fs') return fs; if (name === 'path') return path; if (name === 'url') return url; if (name === 'crypto') return require('node:crypto');
    if (name === 'process') return { env: {}, platform: 'win32' };
    if (name === path.join(root, 'js/render.js')) return { render: async () => {} }; throw Error(name);
  };
  const window = { CardModel: Model, cep_node: { require: nodeRequire }, __adobe_cep__: {
    getSystemPath: kind => options.nativePaths ? kind === 'userData' ? userData : root : url.pathToFileURL(kind === 'userData' ? userData : root).href,
    evalScript: (script, callback) => {
      assert.equal(/[\u2028\u2029]/.test(script), false);
      const run = () => { try { callback(vm.runInNewContext(script, { $: { evalFile: () => {} }, File: function (p) { this.fsName = p; }, CardReveal: methods })); } catch (_) { callback('EvalScript error.'); } };
      if (options.defer && script.includes('CardReveal.' + options.defer + '(')) deferred.push(run); else run();
    }
  } };
  if (options.dialog) window.cep = { fs: { showOpenDialog: options.dialog } };
  const context = vm.createContext({ window, AbortController, console }); vm.runInContext(bridgeSource, context);
  return { api: window.CardBridge, source, binary, userData, calls, deferred, cleanup: () => fs.rmSync(folder, { recursive: true, force: true }) };
}
test('CEP preserves the complete template binary outside the extension and leaves the original untouched', async t => {
  for (const nativePaths of [false, true]) {
    const env = bridgeSetup({ nativePaths }); t.after(env.cleanup);
    const picked = await env.api.pickTitleTemplate(); assert.equal(picked.path, env.source);
    const first = await env.api.preserveTitleTemplate(picked.path), second = await env.api.preserveTitleTemplate(picked.path);
    assert.notEqual(first.templatePath, second.templatePath); assert.ok(first.templatePath.startsWith(path.join(env.userData, 'CardRevealStudio', 'telop-templates') + path.sep));
    assert.deepEqual(fs.readFileSync(first.templatePath), env.binary); assert.deepEqual(fs.readFileSync(env.source), env.binary);
    await env.api.insertTitle({ templatePath: first.templatePath, videoTrack: 0 }); assert.deepEqual(env.calls, [[first.templatePath, 0]]);
  }
});
test('CEP picker cancellation, wrong formats, missing and empty binaries stay errors or cancelled', async t => {
  const cancel = bridgeSetup({ dialog: (...args) => { assert.deepEqual(Array.from(args[4]), ['mogrt']); return { err: 0, data: [] }; } }); t.after(cancel.cleanup); assert.equal(await cancel.api.pickTitleTemplate(), null);
  const env = bridgeSetup(); t.after(env.cleanup);
  for (const value of ['relative.mogrt', path.join(env.userData, 'missing.mogrt'), env.source.replace('.mogrt', '.png')]) await assert.rejects(env.api.preserveTitleTemplate(value));
  fs.writeFileSync(env.source, ''); await assert.rejects(env.api.preserveTitleTemplate(env.source), /有効な/); assert.equal(env.calls.length, 0);
});
test('CEP serializes insertion, blocks rendering meanwhile, and clears its lock on completion or failure', async t => {
  const env = bridgeSetup({ defer: 'insertTitle' }); t.after(env.cleanup);
  const record = { templatePath: env.source, videoTrack: 'auto' }, pending = env.api.insertTitle(record);
  await assert.rejects(env.api.insertTitle(record), /ほかの/); await assert.rejects(env.api.render(Model.createProject()), /テロップ/);
  assert.equal(env.deferred.length, 1); env.deferred.shift()(); assert.equal((await pending).verified, true); assert.equal(env.calls.length, 1);
  const again = env.api.insertTitle(record); env.deferred.shift()(); await again; assert.equal(env.calls.length, 2);
  const render = bridgeSetup({ defer: 'pickOutput' }); t.after(render.cleanup); const renderPending = render.api.render(Model.createProject());
  await assert.rejects(render.api.insertTitle({ templatePath: render.source, videoTrack: 'auto' }), /ほかの/); render.deferred.shift()(); assert.equal(await renderPending, null);
});
test('CEP rejects malformed completion messages and allows a later intentional retry', async t => {
  for (const response of ['null', '{"ok":true}', '{"ok":true,"inserted":true,"verified":true,"videoTrack":0,"startTicks":12}', '{"ok":false,"error":"シーケンスを開いてください"}']) {
    const env = bridgeSetup({ host: { insertTitle: () => response } }); t.after(env.cleanup);
    const record = { templatePath: env.source, videoTrack: 'auto' };
    await assert.rejects(env.api.insertTitle(record), /確認|シーケンス/); await assert.rejects(env.api.insertTitle(record), /確認|シーケンス/);
  }
});
test('inspection of a dropped template validates the real local file without copying or importing it', async t => {
  const env = bridgeSetup(); t.after(env.cleanup);
  const result = await env.api.inspectTitleTemplate(env.source);
  assert.equal(result.path, env.source); assert.equal(result.sourceName, path.basename(env.source));
  assert.deepEqual(fs.readFileSync(env.source), env.binary); assert.equal(fs.existsSync(env.userData), false); assert.equal(env.calls.length, 0);
  await assert.rejects(env.api.inspectTitleTemplate('https://example.com/text.mogrt'), /mogrt/);
  fs.unlinkSync(env.source); await assert.rejects(env.api.inspectTitleTemplate(env.source), /見つからない|読み取れません/);
});
