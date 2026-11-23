'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Lib = require('../js/library'), Model = require('../js/model'), Groups = require('../js/media-groups');
function storage(raw) { let value = raw; return { getItem: key => key === Lib.key ? value : null, setItem: (key, next) => { if (key === Lib.key) value = next; } }; }
function fixture() { const state = Lib.create(), project = Model.createProject(); project.cards[0].mediaPath = 'C:/素材/ボス.png'; project.cards[0].mediaType = 'image'; Lib.savePreset(state, { name: 'ボス紹介', groupId: 'main', project }); Lib.savePlacement(state, { ...Lib.placementFrom(project, project.cards[0].id), name: '右側のボス' }); Lib.saveTitle(state, { name: '以前のテキスト', groupId: 'main', videoTrack: 'auto', templatePath: 'C:/old.mogrt' }); return state; }
test('old libraries gain independent uncategorized media folders without rewriting existing storage or records', () => {
 const old = fixture(); delete old.mediaGroups; const raw = JSON.stringify(old), store = storage(raw), next = Lib.load(store);
 assert.equal(store.getItem(Lib.key), raw); assert.deepEqual(next.presets, old.presets); assert.deepEqual(next.assets, old.assets); assert.deepEqual(next.titles, old.titles);
 assert.equal(next.mediaGroups.image.groups[0].name, '未分類'); assert.notEqual(next.mediaGroups.image.activeGroupId, next.mediaGroups.video.activeGroupId);
 Lib.save(store, next); assert.deepEqual(Lib.load(store), next);
});
test('image and video groups have separate names and active selections, with normalized hash-style input', () => {
 const state = Lib.create(), image = Groups.add(state, 'image', '  # 配信素材 '), video = Groups.add(state, 'video', '配信素材');
 assert.equal(image.name, '配信素材'); assert.notEqual(image.id, video.id); Groups.rename(state, 'image', image.id, 'サムネイル'); assert.equal(video.name, '配信素材');
 assert.throws(() => Groups.add(state, 'image', 'サムネイル'), /同じ名前/); Groups.select(state, 'video', video.id); assert.equal(Groups.section(state, 'image').activeGroupId, image.id);
});
test('assigning and reloading media membership keeps the source paths, placements, projects and old title records intact', () => {
 const state = fixture(), original = { presets: Lib.clone(state.presets), assets: Lib.clone(state.assets), titles: Lib.clone(state.titles) }, folder = Groups.add(state, 'image', 'ボス');
 Groups.assign(state, 'image', ['C:/素材/ボス.png', 'C:/素材/ボス.png'], folder.id); assert.equal(state.mediaGroups.image.assignments.length, 1); assert.equal(Groups.groupFor(state, 'image', 'C:/素材/ボス.png'), folder.id);
 assert.notEqual(Groups.groupFor(state, 'video', 'C:/素材/ボス.png'), folder.id); const restored = Lib.load(storage(JSON.stringify(state))); assert.equal(Groups.groupFor(restored, 'image', 'C:/素材/ボス.png'), folder.id);
 assert.deepEqual({ presets: state.presets, assets: state.assets, titles: state.titles }, original);
});
test('deleting a folder moves all memberships to a remaining folder and never removes media records', () => {
 const state = fixture(), folder = Groups.add(state, 'image', 'ボス'), target = Groups.section(state, 'image').groups[0], count = state.assets.length;
 Groups.assign(state, 'image', ['C:/素材/ボス.png', '/offline.png'], folder.id); Groups.remove(state, 'image', folder.id, target.id); assert.equal(state.assets.length, count); assert.equal(state.presets.length, 1); assert.equal(Groups.groupFor(state, 'image', '/offline.png'), target.id); assert.equal(Groups.section(state, 'image').activeGroupId, target.id);
 assert.throws(() => Groups.remove(state, 'image', target.id), /最後/); Lib.validate(state);
 const a = Groups.add(state, 'image', 'A'), b = Groups.add(state, 'image', 'B'); Groups.remove(state, 'image', target.id, b.id); assert.equal(Groups.groupFor(state, 'image', '/new-file.png'), b.id); assert.ok(Groups.section(state, 'image').groups.some(group => group.id === a.id));
});
test('unknown versions and damaged membership do not overwrite existing library storage', () => {
 const state = fixture(), bad = [s => { s.mediaGroups.version = 99; }, s => { s.mediaGroups.image.activeGroupId = 'missing'; }, s => { s.mediaGroups.image.assignments = [{ mediaPath: 'file.png', groupId: 'missing' }]; }, s => { s.mediaGroups.image.groups.push({ ...s.mediaGroups.image.groups[0] }); }];
 for (const damage of bad) { const copy = Lib.clone(state); damage(copy); const raw = JSON.stringify(copy), store = storage(raw); assert.throws(() => Lib.load(store), /元データ/); assert.equal(store.getItem(Lib.key), raw); }
});
test('invalid paths, names and stale move targets fail before modifying memberships', () => {
 const state = fixture(), id = Groups.section(state, 'image').activeGroupId, before = JSON.stringify(state);
 for (const paths of [[], ['okay.png', ''], [null], ['x\u0000y']]) assert.throws(() => Groups.assign(state, 'image', paths, id));
 assert.throws(() => Groups.assign(state, 'image', ['x.png'], 'missing')); assert.throws(() => Groups.add(state, 'image', '#')); assert.throws(() => Groups.rename(state, 'image', id, 'x'.repeat(41))); assert.equal(JSON.stringify(state), before);
});
test('retired title names no longer reserve names for saved plugins', () => {
 const state = fixture(), original = Lib.clone(state.titles); Lib.savePreset(state, { name: '以前のテキスト', groupId: 'main', project: Model.createProject() }); assert.deepEqual(state.titles, original); assert.equal(state.presets.length, 2);
});
