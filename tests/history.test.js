'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const History = require('../js/history');
test('undo and redo return independent snapshots of drafts, including transient source references', () => {
  const h = History.create(), draft = { project: { x: 0 }, sources: { one: { url: 'blob:old' } } };
  h.reset(draft); draft.project.x = 30; draft.sources.one.url = 'blob:new'; h.push(draft);
  const old = h.undo(); assert.equal(old.project.x, 0); assert.equal(old.sources.one.url, 'blob:old'); old.project.x = 100;
  assert.equal(h.redo().project.x, 30); assert.equal(h.undo().project.x, 0); assert.deepEqual(h.info(), { undo: 0, redo: 1 });
});
test('identical snapshots preserve redo, while an intentional edit branches without overwriting the previous action', () => {
  const h = History.create(); h.reset({ x: 0 }); h.push({ x: 10 }, { key: 'slider', at: 10 }); h.push({ x: 20 }, { at: 20 });
  h.undo(); assert.equal(h.push({ x: 10 }), false); assert.equal(h.info().redo, 1);
  h.push({ x: 15 }, { key: 'slider', at: 30 }); assert.equal(h.info().redo, 0); assert.equal(h.undo().x, 10); assert.equal(h.undo().x, 0);
});
test('continuous input can merge, but different controls, separate actions, expired input and reversed clocks remain distinct', () => {
  const h = History.create(); h.reset({ x: 0 }); h.push({ x: 10 }, { key: 'x', at: 10 }); h.push({ x: 11 }, { key: 'x', at: 500 });
  assert.equal(h.info().undo, 1); h.push({ x: 12 }, { key: 'x', at: 1500 }); h.push({ x: 13 }, { key: 'y', at: 1600 }); h.push({ x: 14 }, { key: 'y', at: 1400 }); h.push({ x: 15 }); h.push({ x: 16 });
  assert.equal(h.info().undo, 6); assert.equal(h.undo().x, 15); assert.equal(h.undo().x, 14);
});
test('history retains a bounded number of complete undo operations and reset removes unrelated drafts', () => {
  const h = History.create(3); h.reset({ x: 0 }); for (let x = 1; x <= 10; x++) h.push({ x });
  assert.equal(h.info().undo, 3); assert.equal(h.undo().x, 9); assert.equal(h.undo().x, 8); assert.equal(h.undo().x, 7); assert.equal(h.undo(), null);
  h.reset({ x: 50 }); assert.deepEqual(h.info(), { undo: 0, redo: 0 }); assert.equal(h.redo(), null);
});
test('resource visitors include redo snapshots and expose copies, so pruning cannot revoke a redo source', () => {
  const h = History.create(); h.reset({ source: 'blob:one' }); h.push({ source: 'blob:two' }); h.undo();
  const refs = []; h.visit(value => { refs.push(value.source); value.source = 'bad'; }); assert.deepEqual(refs, ['blob:one', 'blob:two']); assert.equal(h.redo().source, 'blob:two');
});
test('returning a continuous adjustment to its original value leaves no redundant undo step', () => {
  const h = History.create(); h.reset({ scale: 100 }); h.push({ scale: 150 }, { key: 'scale', at: 10 }); h.push({ scale: 100 }, { key: 'scale', at: 20 });
  assert.deepEqual(h.info(), { undo: 0, redo: 0 }); assert.equal(h.undo(), null);
});
test('intentional undo/redo ends a continuous gesture before the next edit', () => {
  const h = History.create(); h.reset({ x: 0 }); h.push({ x: 10 }, { key: 'x', at: 10 }); h.undo(); h.redo(); h.push({ x: 11 }, { key: 'x', at: 20 });
  assert.equal(h.info().undo, 2); assert.equal(h.undo().x, 10); assert.equal(h.undo().x, 0);
});
