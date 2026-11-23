'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Media = require('../js/media-library');
test('media collection merges placement and effect references without changing saved data', () => {
  const image = { mediaPath: 'C:/素材/ボス.png', mediaType: 'image', name: 'ボス' }, video = { mediaPath: 'C:/素材/紹介.mp4', mediaType: 'video', name: '紹介動画' };
  const state = { assets: [{ ...image, id: 'a1', sourceName: '元のボス画像' }, { ...image, id: 'a2' }], presets: [{ id: 'p1', name: 'ボス紹介', project: { mode: 'cards', cards: [image, image, video] } }, { id: 'p2', name: '一覧', project: { mode: 'cards', cards: [image] } }] }, before = JSON.stringify(state);
  const items = Media.collect(state); assert.equal(items.length, 2); assert.deepEqual(items[0].assetIds, ['a1', 'a2']); assert.deepEqual(items[0].presetIds, ['p1', 'p2']); assert.deepEqual(items[0].usedBy, ['ボス紹介', '一覧']); assert.equal(items[0].name, '元のボス画像'); assert.equal(items[1].mediaType, 'video'); assert.equal(JSON.stringify(state), before);
});
test('only active highlight and split sources appear, while empty and invalid media are ignored', () => {
  const media = i => ({ mediaPath: '/素材/' + i + '.png', mediaType: 'image' });
  const items = Media.collect({ presets: [{ id: 'h', name: '枠', project: { mode: 'highlight', cards: [media(1), media(2)] } }, { id: 's', name: '3分割', project: { mode: 'trapezoid', cards: [media(3), media(4), media(5), media(6)] } }, { id: 'empty', project: { cards: [{ mediaPath: '', mediaType: 'image' }, { mediaPath: 42, mediaType: 'video' }, { mediaPath: 'x', mediaType: 'audio' }] } }] });
  assert.deepEqual(items.map(item => item.mediaPath), [1, 3, 4, 5].map(i => '/素材/' + i + '.png'));
});
test('collection handles empty libraries and encoded or unusual filenames without conflating types', () => {
  assert.deepEqual(Media.collect(null), []); assert.deepEqual(Media.collect({}), []);
  const items = Media.collect({ assets: [{ id: 'a', mediaPath: 'https://example.test/%E3%83%9C%E3%82%B9.png', mediaType: 'image' }, { id: 'b', mediaPath: '__proto__', mediaType: 'image' }, { id: 'c', mediaPath: '__proto__', mediaType: 'video' }, { id: 'd', mediaPath: '100%.png', mediaType: 'image' }] });
  assert.equal(items[0].name, 'ボス.png'); assert.equal(items.length, 4); assert.equal(items[3].filename, '100%.png');
});

test('batch registration uses the selected group for each type and keeps placements when a path is dropped again', () => {
  const Lib = require('../js/library'), Groups = require('../js/media-groups');
  const state = Lib.create(), imageGroup = Groups.add(state, 'image', '立ち絵'), videoGroup = Groups.add(state, 'video', '紹介');
  const image = { type: 'image', path: 'C:/素材/a.png', name: 'a.png' }, video = { type: 'video', path: 'C:/素材/cut.mov', name: 'cut.mov' };
  const same = { ...image, path: 'c:\\素材\\A.PNG' };
  const results = Media.register(state, [image, same, video]);
  assert.deepEqual(results.map(item => [item.count, item.groupName]), [[1, '立ち絵'], [1, '紹介']]);
  assert.equal(state.assets.length, 2);
  assert.equal(Groups.groupFor(state, 'image', image.path), imageGroup.id);
  assert.equal(Groups.groupFor(state, 'video', video.path), videoGroup.id);
  state.assets[0].mediaX = 41; state.assets[0].mediaScale = 130;
  const before = Lib.clone(state.assets);
  const other = Groups.add(state, 'image', '別の画像');
  Media.register(state, [same, video]);
  assert.deepEqual(state.assets, before);
  assert.equal(Groups.groupFor(state, 'image', image.path), other.id);
  assert.equal(Groups.groupFor(state, 'video', video.path), videoGroup.id);
});

test('registering media from a saved effect reuses its path and handles equal filenames from separate folders', () => {
  const Lib = require('../js/library'), state = Lib.create(), project = Lib.baseProject('cards');
  Object.assign(project.cards[0], { mediaPath: 'C:/One/素材.png', mediaType: 'image' });
  Lib.savePreset(state, { name: '演出', groupId: 'main', project });
  const before = Lib.clone(state.presets);
  Media.register(state, [{ type: 'image', name: '素材.png', path: 'c:\\ONE\\素材.png' }, { type: 'image', name: '素材.png', path: 'D:/別/素材.png' }]);
  assert.equal(Media.collect(state).length, 2);
  assert.deepEqual(state.assets.map(asset => asset.name), ['素材.png', '素材.png (2)']);
  assert.equal(state.assets[0].mediaPath, project.cards[0].mediaPath);
  assert.deepEqual(state.presets, before);
});
