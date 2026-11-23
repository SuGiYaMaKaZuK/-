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
