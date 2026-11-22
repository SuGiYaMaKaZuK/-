'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), url = require('node:url'), vm = require('node:vm');
const Model = require('../js/model'), Timeline = require('../js/timeline-model'), Lib = require('../js/library');
const bridgeCode = fs.readFileSync(path.join(__dirname, '../js/bridge.js'), 'utf8');
const candidate = { projectId: 'project', sequenceId: 'sequence', sequenceName: '編集用', clipId: 'clip', clipName: '字幕 "白"\u2028', trackIndex: 0, clipIndex: 0, startTicks: '900719925474099312', endTicks: '900720941538099312', width: 1920, height: 1080, timebase: '8467200000' };
const template = { sequenceId: 'captured-sequence', width: 1920, height: 1080, timebase: '8467200000', durationTicks: '1016064000000', sourceName: '字幕' };
function setup(options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-bridge-')), root = path.join(folder, '拡張 100%20'), userData = path.join(folder, '利用者 "字幕"'), outputs = [], calls = [], queue = [];
  const host = Object.assign({
    trialSelection: () => JSON.stringify({ ok: true, candidate }),
    trialCapture: (value, destination) => { calls.push(['capture', value, destination]); fs.writeFileSync(destination, options.emptyFile ? '' : 'native-project-binary'); outputs.push(destination); if (options.captureFailure) return JSON.stringify({ ok: false, stage: 'export', error: '書き出しを確認できません' }); return JSON.stringify({ ok: true, template, warnings: [] }); },
    trialInsert: (...args) => { calls.push(['insert', ...args]); return JSON.stringify({ ok: true, inserted: true, verified: true, videoTrack: 1, audioAdded: 0, startTicks: '900719925474099312' }); },
    pickTrialReport: () => options.cancelReport ? 'null' : JSON.stringify(path.join(folder, 'diagnostic.json')),
    pickOutput: () => 'null'
  }, options.host);
  const nodeRequire = name => {
    if (name === 'fs') return fs; if (name === 'path') return path; if (name === 'url') return url; if (name === 'process') return { env: {}, platform: 'win32' }; if (name === 'crypto') return require('node:crypto'); throw Error(name);
  };
  const window = { CardModel: Model, CardTimelineModel: Timeline, cep_node: { require: nodeRequire }, __adobe_cep__: {
    getSystemPath: kind => options.nativePaths ? kind === 'userData' ? userData : root : url.pathToFileURL(kind === 'userData' ? userData : root).href,
    evalScript: (script, callback) => {
      assert.equal(/[\u2028\u2029]/.test(script), false);
      const run = () => { try { callback(vm.runInNewContext(script, { $: { evalFile: file => { if (/CardTimelineTrial\./.test(script)) assert.equal(file.fsName, path.join(root, 'js/timeline-host.jsx')); } }, File: function (p) { this.fsName = p; }, CardReveal: host, CardTimelineTrial: host })); } catch (e) { callback('EvalScript error.'); } };
      if (options.defer && script.includes('CardTimelineTrial.' + options.defer + '(')) queue.push(run); else run();
    }
  } };
  vm.runInNewContext(bridgeCode, { window, AbortController, console });
  return { api: window.CardBridge, folder, root, userData, outputs, calls, queue, cleanup: () => fs.rmSync(folder, { recursive: true, force: true }) };
}
test('trial bridge reads candidates without allocating files and preserves projects in unique user-data folders', async t => {
  for (const nativePaths of [false, true]) {
    const env = setup({ nativePaths }); t.after(env.cleanup); const value = await env.api.readTimelineCandidate(); assert.deepEqual(JSON.parse(JSON.stringify(value)), candidate); assert.equal(fs.existsSync(env.userData), false);
    const a = await env.api.preserveTimelineTitle(candidate), b = await env.api.preserveTimelineTitle(candidate);
    assert.notEqual(a.templatePath, b.templatePath); assert.ok(a.templatePath.startsWith(path.join(env.userData, 'CardRevealStudio', 'timeline-titles') + path.sep)); assert.equal(fs.readFileSync(a.templatePath, 'utf8'), 'native-project-binary'); assert.equal(a.sequenceId, template.sequenceId); assert.equal(a.width, 1920);
    await env.api.insertTitle({ ...a, sourceType: 'timeline', videoTrack: 'auto' }); const inserted = env.calls.find(row => row[0] === 'insert'); assert.equal(inserted[1], a.templatePath); assert.equal(inserted[2], template.sequenceId); assert.equal(inserted[3], 'auto'); assert.equal(inserted[4].durationTicks, template.durationTicks);
  }
});
test('failed captures remove only their newly allocated folder and preserve the stage for diagnostics', async t => {
  for (const options of [{ captureFailure: true }, { emptyFile: true }]) {
    const env = setup(options); t.after(env.cleanup); fs.mkdirSync(env.userData, { recursive: true }); const sentinel = path.join(env.userData, 'keep.prproj'); fs.writeFileSync(sentinel, 'original');
    await assert.rejects(env.api.preserveTimelineTitle(candidate), error => { if (options.captureFailure) assert.equal(error.stage, 'export'); return true; }); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'original'); assert.equal(fs.existsSync(env.outputs[0]), false); assert.equal(fs.existsSync(path.dirname(env.outputs[0])), false); assert.deepEqual(JSON.parse(JSON.stringify(await env.api.readTimelineCandidate())), candidate);
  }
});
test('capture and insertion share the render lock and release it after completion', async t => {
  const env = setup({ defer: 'trialCapture' }); t.after(env.cleanup); const pending = env.api.preserveTimelineTitle(candidate);
  await assert.rejects(env.api.preserveTimelineTitle(candidate), /ほかの/); await assert.rejects(env.api.readTimelineCandidate(), /処理/); await assert.rejects(env.api.render(Model.createProject()), /テロップ/);
  env.queue.shift()(); const saved = await pending; assert.ok(saved.templatePath); assert.deepEqual(JSON.parse(JSON.stringify(await env.api.readTimelineCandidate())), candidate);
});
test('invalid candidate and completion messages do not create successful registrations', async t => {
  const env = setup(); t.after(env.cleanup); await assert.rejects(env.api.preserveTimelineTitle({ ...candidate, clipId: '' }), /識別/); assert.equal(fs.existsSync(env.userData), false);
  for (const response of ['null', '{"ok":true}', JSON.stringify({ ok: true, template: { ...template, sequenceId: '' }, warnings: [] })]) {
    const broken = setup({ host: { trialCapture: () => response } }); t.after(broken.cleanup); await assert.rejects(broken.api.preserveTimelineTitle(candidate));
  }
  const badInsert = setup({ host: { trialInsert: () => '{"ok":true}' } }); t.after(badInsert.cleanup); const saved = await badInsert.api.preserveTimelineTitle(candidate); await assert.rejects(badInsert.api.insertTitle({ ...saved, sourceType: 'timeline', videoTrack: 'auto' }), /再度押す前/);
});
test('diagnostics are saved only after the native save dialog, and cancellation creates no report', async t => {
  const env = setup(); t.after(env.cleanup); const report = { nativeDropIdentityVerified: false, events: [{ phase: 'drop', types: [] }] }, output = await env.api.saveTimelineTrialReport(report); assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);
  const cancelled = setup({ cancelReport: true }); t.after(cancelled.cleanup); assert.equal(await cancelled.api.saveTimelineTrialReport(report), null); assert.equal(fs.existsSync(path.join(cancelled.folder, 'diagnostic.json')), false);
});
test('native title records retain only portable capture metadata while existing MOGRT records stay compatible', () => {
  const state = Lib.create(), original = Model.createProject(); Lib.savePreset(state, { groupId: 'main', name: '演出', project: original });
  const saved = Lib.saveTitle(state, { ...template, name: '試験字幕', groupId: 'main', videoTrack: 'auto', sourceType: 'timeline', templatePath: 'C:/UserData/title.prproj', projectId: 'private-selection-project' });
  assert.equal(saved.sourceType, 'timeline'); assert.equal(saved.sequenceId, template.sequenceId); assert.equal(saved.projectId, undefined); assert.deepEqual(state.presets[0].project, original);
  const group = Lib.addGroup(state, '別グループ'); Lib.removeGroup(state, 'main', group.id); assert.equal(state.titles[0].groupId, group.id); Lib.validate(state);
  const before = JSON.stringify(state); for (const patch of [{ width: 0 }, { sequenceId: '' }, { durationTicks: '0' }, { templatePath: 'C:/wrong.mogrt' }]) { assert.throws(() => Lib.saveTitle(state, { ...saved, ...patch, id: saved.id, groupId: group.id })); assert.equal(JSON.stringify(state), before); }
  Lib.removeTitle(state, saved.id); assert.equal(state.titles.length, 0); assert.equal(state.presets.length, 1);
});
