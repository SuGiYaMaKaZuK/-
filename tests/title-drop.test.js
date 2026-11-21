'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Drop = require('../js/title-drop');
function file(path, name = '字幕.mogrt', size = 100) { return { name, path, size }; }
test('drop accepts one local MOGRT file with its actual CEP file path', () => {
  for (const path of ['C:\\素材\\字幕 "白" 100%20.mogrt', '\\\\server\\共有\\字幕.MOGRT', '/tmp/字幕.mogrt']) assert.equal(Drop.pathFrom({ files: [file(path)] }), path);
});
test('empty native timeline payloads, text paths and URLs never substitute another selected clip', () => {
  for (const value of [null, {}, { files: [], types: ['application/x-premiere-clip'] }, { files: [], getData: () => 'C:/字幕.mogrt' }]) assert.throws(() => Drop.pathFrom(value), /タイムライン.*直接登録できません/);
});
test('multiple files, non-template sources and files beyond the supported size are rejected', () => {
  assert.throws(() => Drop.pathFrom({ files: [file('C:/a.mogrt'), file('C:/b.mogrt')] }), /1つずつ/);
  for (const name of ['字幕.png', '字幕.mogrt.exe', '字幕.mp4']) assert.throws(() => Drop.pathFrom({ files: [file('C:/source', name)] }), /登録できるのは/);
  assert.throws(() => Drop.pathFrom({ files: [file('C:/字幕.mogrt', '字幕.mogrt', 256 * 1024 * 1024 + 1)] }), /256MB/);
});
test('missing, relative, URL and control-character paths require the normal native picker', () => {
  for (const path of [undefined, '', '字幕.mogrt', 'https://example.com/字幕.mogrt', 'C:/bad\n字幕.mogrt']) assert.throws(() => Drop.pathFrom({ files: [file(path)] }), /ファイルの場所/);
});
