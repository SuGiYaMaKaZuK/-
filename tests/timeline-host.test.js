'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../js/timeline-host.jsx'), 'utf8');
const T = 254016000000n, begin = 900719925474099312n, duration = T * 4n;
function time(ticks) { return { ticks: String(ticks), seconds: Number(ticks) / Number(T) }; }
function clip(id, start = begin, length = duration) { return { nodeId: id, name: 'いつもの字幕 "白"', start: time(start), end: time(start + length), inPoint: time(0n), disabled: false, font: Object.freeze({ family: '源ノ角ゴシックJP', size: 56, x: 0.5, y: 0.9 }), isAdjustmentLayer: () => false, projectItem: { isSequence: () => false }, selected: false, setSelected(value) { this.selected = !!value; } }; }
function collection(items, property) { return Object.assign({ [property]: items.length }, items); }
function track(items = []) { return { clips: collection(items, 'numItems'), isLocked: () => false, isMuted: () => false }; }
function makeSequence(id, videos = [track([clip('caption')])], audio = [track()]) {
  const seq = { sequenceID: id, name: '編集用', frameSizeHorizontal: 1920, frameSizeVertical: 1080, timebase: '8467200000', videoTracks: collection(videos, 'numTracks'), audioTracks: collection(audio, 'numTracks'), in: 'original-in', out: 'original-out', position: time(begin), rangeWrites: [],
    getInPoint() { return this.in; }, getOutPoint() { return this.out; }, getPlayerPosition() { return this.position; }, setPlayerPosition(ticks) { this.position = time(BigInt(ticks)); },
    setInPoint(value) { this.rangeWrites.push(['in', value]); this.in = value; }, setOutPoint(value) { this.rangeWrites.push(['out', value]); this.out = value; },
    getSelection() { return [this.videoTracks[0].clips[0]]; }
  }; seq.projectItem = { sequence: seq, isSequence: () => true }; return seq;
}
function setup(options = {}) {
  const source = makeSequence('source'), sibling = makeSequence('other'), existing = new Map(), deleted = [], exported = [], imports = [], writes = [];
  if (options.multipleSelection) source.getSelection = () => [source.videoTracks[0].clips[0], clip('another')];
  if (options.noSelection) source.getSelection = () => [];
  if (options.adjustment) source.videoTracks[0].clips[0].isAdjustmentLayer = () => true;
  const list = [source, sibling];
  const project = { documentID: 'project-1', activeSequence: options.noSequence ? null : source, sequences: collection(list, 'numSequences'),
    deleteSequence(seq) { deleted.push(seq.sequenceID); if (options.cleanupFailure) return false; const at = list.indexOf(seq); if (at >= 0) list.splice(at, 1); refresh(); return true; },
    openSequence(id) { const seq = list.find(s => s.sequenceID === id); if (!seq) return false; this.activeSequence = seq; return true; }
  };
  function refresh() { project.sequences = collection(list, 'numSequences'); }
  source.clone = () => {
    if (options.cloneError) throw Error('clone failed');
    if (options.cloneOriginal) return source;
    const copy = makeSequence('copy', [track([clip('copied')])]);
    copy.createSubsequence = ignore => {
      assert.equal(ignore, true); if (options.subError) throw Error('subsequence failed');
      const inner = clip('isolated', options.leadingBlank ? 1n : 0n), sub = makeSequence('isolated-sequence', [track([inner])]);
      if (options.extraAudio) sub.audioTracks = collection([track([clip('unexpected-audio', 0n)])], 'numTracks');
      sub.exportAsProject = destination => { if (options.exportError) throw Error('export failed'); exported.push({ destination, name: sub.name, font: inner.font, start: inner.start.ticks, duration: String(BigInt(inner.end.ticks) - BigInt(inner.start.ticks)) }); existing.set(destination, options.emptyExport ? 0 : 128); };
      list.push(sub); refresh(); project.activeSequence = sub; return sub;
    };
    list.push(copy); refresh(); project.activeSequence = copy; return options.booleanClone ? true : copy;
  };
  function File(value) { this.fsName = value; Object.defineProperties(this, { exists: { get: () => existing.has(value) }, length: { get: () => existing.get(value) || 0 } }); }
  const context = vm.createContext({ app: { project: options.noProject ? null : project }, File }); vm.runInContext(code, context);
  const api = context.CardTimelineTrial, call = (name, ...args) => JSON.parse(api[name](...args));
  return { source, sibling, project, list, existing, deleted, exported, imports, writes, api, call, candidate: () => call('trialSelection').candidate, refresh };
}
test('read-only trial selection identifies one video instance with exact string ticks and its sequence format', () => {
  const env = setup(), before = JSON.stringify(env.source.videoTracks), value = env.call('trialSelection');
  assert.equal(value.ok, true); assert.equal(value.candidate.clipId, 'caption'); assert.equal(value.candidate.startTicks, String(begin)); assert.equal(value.candidate.endTicks, String(begin + duration)); assert.equal(value.candidate.width, 1920); assert.equal(env.exported.length, 0); assert.equal(env.deleted.length, 0); assert.equal(JSON.stringify(env.source.videoTracks), before);
  for (const options of [{ noProject: true }, { noSequence: true }, { noSelection: true }, { multipleSelection: true }, { adjustment: true }]) assert.equal(setup(options).call('trialSelection').ok, false);
});
test('capture exports only an isolated copy and never changes original clips, typography or in/out points', () => {
  for (const booleanClone of [false, true]) {
    const env = setup({ booleanClone }), c = env.candidate(), before = JSON.stringify(env.source.videoTracks), result = env.call('trialCapture', c, 'C:/UserData/trial/title.prproj');
    assert.equal(result.ok, true); assert.equal(result.template.durationTicks, String(duration)); assert.equal(result.template.sequenceId, 'isolated-sequence'); assert.equal(result.template.width, 1920); assert.deepEqual(result.warnings, []);
    assert.deepEqual(env.deleted, ['isolated-sequence', 'copy']); assert.deepEqual(env.list.map(s => s.sequenceID), ['source', 'other']); assert.equal(env.project.activeSequence, env.source);
    assert.equal(JSON.stringify(env.source.videoTracks), before); assert.deepEqual(env.source.rangeWrites, []); assert.equal(env.source.in, 'original-in'); assert.equal(env.source.out, 'original-out'); assert.deepEqual(env.exported[0].font, { family: '源ノ角ゴシックJP', size: 56, x: 0.5, y: 0.9 }); assert.equal(env.exported[0].start, '0');
  }
});
test('stale selections, switched documents, pre-existing output and unexpected copies stop before export', () => {
  for (const field of ['projectId', 'sequenceId', 'clipId', 'clipName', 'startTicks', 'endTicks', 'width', 'timebase']) { const env = setup(), candidate = env.candidate(); candidate[field] = field === 'width' ? 1280 : 'changed'; assert.equal(env.call('trialCapture', candidate, 'C:/new.prproj').ok, false); assert.equal(env.exported.length, 0); assert.equal(env.deleted.length, 0); }
  const existing = setup(); existing.existing.set('C:/existing.prproj', 200); assert.equal(existing.call('trialCapture', existing.candidate(), 'C:/existing.prproj').ok, false); assert.equal(existing.existing.get('C:/existing.prproj'), 200);
  const original = setup({ cloneOriginal: true }); assert.equal(original.call('trialCapture', original.candidate(), 'C:/new.prproj').ok, false); assert.equal(original.deleted.includes('source'), false);
});
test('capture failures clean up only owned temporary sequences and expose the failing stage', () => {
  for (const [options, stage, removed] of [[{ subError: true }, 'subsequence', ['copy']], [{ extraAudio: true }, 'subsequence', ['isolated-sequence', 'copy']], [{ leadingBlank: true }, 'subsequence', ['isolated-sequence', 'copy']], [{ exportError: true }, 'export', ['isolated-sequence', 'copy']], [{ emptyExport: true }, 'export', ['isolated-sequence', 'copy']]]) {
    const env = setup(options), result = env.call('trialCapture', env.candidate(), 'C:/new.prproj'); assert.equal(result.ok, false); assert.equal(result.stage, stage); assert.deepEqual(env.deleted, removed); assert.equal(env.deleted.includes('source'), false); assert.equal(env.deleted.includes('other'), false); assert.deepEqual(env.source.rangeWrites, []); assert.equal(env.project.activeSequence, env.source);
  }
  const env = setup({ cleanupFailure: true }), result = env.call('trialCapture', env.candidate(), 'C:/new.prproj'); assert.equal(result.ok, true); assert.ok(result.warnings.length); assert.equal(env.deleted.includes('source'), false);
});
function insertion(options = {}) {
  const env = setup(), target = makeSequence('target', [track(), track()], [track()]); env.list.push(target); env.refresh(); env.project.activeSequence = target; env.existing.set('C:/saved.prproj', 200);
  if (options.occupied) target.audioTracks[0].clips = collection([clip('music', 0n, begin + duration)], 'numItems');
  if (options.locked) target.videoTracks[0].isLocked = () => true;
  if (options.wrongFormat) target.frameSizeHorizontal = 1280;
  env.project.importSequences = (file, requested) => {
    env.imports.push({ file, requested: Array.from(requested) }); if (options.importFailure) return false; if (options.noNewSequence) return true;
    const seq = makeSequence('imported', [track([clip('archived', 0n)])]); if (options.badContents) seq.videoTracks[0].clips = collection([clip('bad-one', 0n), clip('bad-two', duration)], 'numItems'); env.list.push(seq); env.refresh(); env.project.activeSequence = seq; return true;
  };
  for (let i = 0; i < 2; i++) target.videoTracks[i].overwriteClip = (item, seconds) => { env.writes.push({ item, seconds, track: i }); if (options.writeError) throw Error('overwrite failed'); const added = clip('inserted', options.wrongStart ? begin + 1n : begin); target.videoTracks[i].clips = collection([added], 'numItems'); if (options.audioAdded) target.audioTracks[0].clips = collection([clip('silent', begin)], 'numItems'); };
  env.insert = (requested = 'auto') => env.call('trialInsert', 'C:/saved.prproj', 'isolated-sequence', requested, { width: 1920, height: 1080, timebase: '8467200000', durationTicks: String(duration) }); return env;
}
test('trial insertion imports a fresh sequence and overwrites an empty target without ripple insertion', () => {
  const env = insertion({ audioAdded: true }), result = env.insert(); assert.equal(result.ok, true); assert.equal(result.verified, true); assert.equal(result.videoTrack, 1); assert.equal(result.audioAdded, 1); assert.equal(result.startTicks, String(begin)); assert.deepEqual(env.imports, [{ file: 'C:/saved.prproj', requested: ['isolated-sequence'] }]); assert.equal(env.writes.length, 1); assert.equal(env.project.activeSequence.sequenceID, 'target'); assert.equal(env.deleted.includes('imported'), false, 'inserted nested sequence dependencies remain in the project');
});
test('trial insertion refuses format mismatches, nonempty or locked tracks before importing or writing', () => {
  for (const options of [{ wrongFormat: true }, { occupied: true }, { locked: true }]) { const env = insertion(options); assert.equal(env.insert().ok, false); assert.equal(env.imports.length, 0); assert.equal(env.writes.length, 0); }
  const badTrack = insertion(); assert.equal(badTrack.insert(5).ok, false); assert.equal(badTrack.imports.length, 0);
});
test('uncertain imports or writes are never retried and post-write dependencies are retained', () => {
  for (const options of [{ importFailure: true }, { noNewSequence: true }, { badContents: true }]) { const env = insertion(options); assert.equal(env.insert().ok, false); assert.equal(env.writes.length, 0); }
  const failed = insertion({ writeError: true }), result = failed.insert(); assert.equal(result.ok, false); assert.equal(result.stage, 'overwrite'); assert.match(result.error, /再度押す前/); assert.equal(failed.writes.length, 1); assert.equal(failed.deleted.includes('imported'), false);
  const uncertain = insertion({ wrongStart: true }); assert.equal(uncertain.insert().verified, false); assert.equal(uncertain.writes.length, 1);
});
