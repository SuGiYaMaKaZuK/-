'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), url = require('node:url'), vm = require('node:vm');
const bridgeSource = fs.readFileSync(path.join(__dirname, '../js/bridge.js'), 'utf8');
const timelineSource = fs.readFileSync(path.join(__dirname, '../js/timeline-host.jsx'), 'utf8');
const Timeline = require('../js/timeline-model');

function setup(options = {}) {
  const root = path.resolve('/tmp/拡張 100%20 "字幕"\u2028'), timers = new Map(), scripts = [], pending = [], reads = [];
  let timerId = 0;
  const clip = { nodeId: 'graphic-1', name: '字幕「白」', start: { ticks: '508032000000' }, end: { ticks: '1524096000000' }, disabled: false, isAdjustmentLayer: () => false, projectItem: { isSequence: () => false } };
  const state = { count: 1, response: options.response || 'normal', missingFile: false };
  const sequence = { sequenceID: 'seq-1', name: '編集用', frameSizeHorizontal: 1920, frameSizeVertical: 1080, timebase: '8467200000', getSelection: () => state.count === 1 ? [clip] : state.count === 0 ? [] : [clip, clip], videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } };
  const native = vm.createContext({ app: { version: '26.0 "試験"\n', project: { documentID: 'project-1', activeSequence: sequence } } });
  const cep = { getSystemPath: () => options.badRoot ? 'relative' : root, evalScript(script, callback) {
    scripts.push(script);
    if (state.response === 'none') { pending.push(callback); return; }
    if (state.response === 'throw') throw Error('native dispatch failed');
    if (state.response === 'empty') return callback('');
    if (state.response === 'syntax') return callback('EvalScript error.');
    if (state.response === 'invalid') return callback('not JSON');
    callback(vm.runInContext(script, native));
  } };
  const window = { CardTimelineModel: Timeline };
  if (!options.noCep) window.__adobe_cep__ = cep;
  if (!options.noNode) window.cep_node = { require(name) {
    if (name === 'path') return path;
    if (name === 'url') return url;
    if (name === 'process') return { env: {}, platform: 'win32' };
    if (name === 'fs') return { readFileSync(filename) { reads.push(filename); if (state.missingFile) throw Error('ENOENT'); assert.equal(filename, path.join(root, 'js/timeline-host.jsx')); return timelineSource; } };
    throw Error(name);
  } };
  const context = vm.createContext({ window, console: { error() {} }, setTimeout(fn, ms) { assert.equal(ms, 10000); const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(bridgeSource, context);
  return { api: window.CardBridge, state, timers, scripts, pending, reads, root, native };
}

test('the real bridge runs the bundled selection JSX directly and returns its actual native result', async () => {
  const env = setup(), value = await env.api.readTimelineCandidate();
  assert.equal(value.clipName, '字幕「白」'); assert.equal(value.sequenceName, '編集用'); assert.equal(value.startTicks, '508032000000');
  assert.equal(env.reads.length, 1); assert.equal(env.scripts.length, 1);
  assert.equal(env.scripts[0].includes('$.evalFile('), false); assert.equal(env.scripts[0].includes(env.root), false);
  assert.equal(env.timers.size, 0); assert.equal(env.api.getHostStatus().lastRequest.state, 'complete');
  env.state.count = 0;
  await assert.rejects(env.api.readTimelineCandidate(), error => error.stage === 'selection' && /1つだけ/.test(error.message));
  assert.equal(env.timers.size, 0);
});

test('selection without a native callback times out, clears waiting state and ignores a late callback', async () => {
  const env = setup({ response: 'none' }), pending = env.api.readTimelineCandidate();
  assert.equal(env.api.getHostStatus().lastRequest.state, 'waiting');
  const timer = [...env.timers.values()][0]; timer();
  await assert.rejects(pending, error => error.code === 'CEP_TIMEOUT' && error.stage === 'communication');
  assert.equal(env.timers.size, 0); assert.equal(env.api.getHostStatus().lastRequest.state, 'error');
  env.state.response = 'normal'; await env.api.readTimelineCandidate();
  const current = env.api.getHostStatus(); env.pending[0]('{"ok":false,"error":"late failure"}');
  assert.deepEqual(env.api.getHostStatus(), current);
});

test('transport, empty/script responses and missing bundled files produce distinct actionable errors', async () => {
  for (const [response, code] of [['throw', 'CEP_DISPATCH_ERROR'], ['empty', 'CEP_EMPTY_RESPONSE'], ['syntax', 'CEP_SCRIPT_ERROR'], ['invalid', 'CEP_INVALID_RESPONSE']]) {
    const env = setup({ response }); await assert.rejects(env.api.readTimelineCandidate(), error => error.code === code); assert.equal(env.timers.size, 0);
  }
  const env = setup(); env.state.missingFile = true;
  await assert.rejects(env.api.readTimelineCandidate(), error => error.code === 'CEP_SCRIPT_MISSING' && error.stage === 'load');
  assert.equal(env.scripts.length, 0); assert.equal(env.timers.size, 0);
});

test('connection probing works without Node or host-file loading and reports the actual selection count', async () => {
  for (const options of [{}, { noNode: true }, { badRoot: true }]) {
    const env = setup(options), result = await env.api.testTimelineConnection();
    assert.equal(result.appVersion, '26.0 "試験"\n'); assert.equal(result.hasProject, true); assert.equal(result.hasSequence, true); assert.equal(result.selectionCount, 1);
    assert.equal(env.reads.length, 0); assert.equal(env.timers.size, 0);
    const local = env.api.getHostStatus(); assert.equal(local.cepAvailable, true); assert.equal(local.ready, !options.noNode && !options.badRoot);
    if (!local.ready) assert.ok(local.initializationError);
    env.state.count = 2; assert.equal((await env.api.testTimelineConnection()).selectionCount, 2);
  }
  const absent = setup({ noCep: true }); await assert.rejects(absent.api.testTimelineConnection(), error => error.code === 'CEP_UNAVAILABLE'); assert.equal(absent.timers.size, 0);
});

test('malformed/failed connection probes reject and callers cannot mutate stored diagnostic state', async () => {
  const invalid = setup({ response: 'invalid' }); await assert.rejects(invalid.api.testTimelineConnection(), error => error.code === 'CEP_INVALID_RESPONSE');
  const env = setup(); vm.runInContext('app.project.activeSequence.getSelection = function(){throw new Error("selection unavailable");}', env.native);
  await assert.rejects(env.api.testTimelineConnection(), error => error.code === 'CEP_PROBE_ERROR' && /selection unavailable/.test(error.message));
  const first = env.api.getHostStatus(); first.ready = false; first.lastRequest.state = 'modified';
  assert.equal(env.api.getHostStatus().ready, true); assert.notEqual(env.api.getHostStatus().lastRequest.state, 'modified');
});
