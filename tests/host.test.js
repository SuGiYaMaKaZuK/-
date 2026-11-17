'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/host.jsx'), 'utf8');

function setup(options = {}) {
  const imports = [], folders = [], opened = [];
  const sourcePath = 'C:\\利用者\\ボス "最終形態"\\紹介.mov';
  function File(filePath) {
    this.fsName = filePath;
    this.exists = options.exists !== false;
    this.saveDlg = () => options.cancel ? null : { fsName: sourcePath };
    this.parent = {
      fsName: path.win32.dirname(filePath),
      exists: options.folderExists !== false,
      execute: () => { opened.push(path.win32.dirname(filePath)); return options.folderExecute !== false; }
    };
  }
  File.openDialog = () => {
    if (options.dialogError) throw options.dialogError;
    return options.cancel ? null : { fsName: sourcePath };
  };
  function Folder(filePath) {
    this.fsName = filePath;
    this.exists = true;
    this.create = () => { folders.push(filePath); return true; };
  }
  Folder.myDocuments = { fsName: 'C:\\利用者\\ドキュメント' };
  const root = { name: 'root' }, selected = { name: 'selected' };
  const project = {
    rootItem: root,
    getInsertionBin: () => options.rootBin ? null : selected,
    importFiles: (files, suppressUI, bin, numberedStills) => {
      imports.push({ files: Array.from(files), suppressUI, bin, numberedStills });
      return options.importSuccess !== false;
    }
  };
  const context = vm.createContext({ File, Folder, app: { project: options.noProject ? null : project } });
  vm.runInContext(source, context);
  return { api: context.CardReveal, imports, folders, opened, root, selected, sourcePath };
}

test('host dialogs serialize Japanese paths, slash escapes and quote characters as valid JSON', () => {
  const env = setup();
  for (const name of ['pickMedia', 'pickSaveProject', 'pickLoadProject', 'pickOutput']) {
    assert.equal(JSON.parse(env.api[name]()), env.sourcePath);
  }
  const cancelled = setup({ cancel: true });
  for (const name of ['pickMedia', 'pickSaveProject', 'pickLoadProject', 'pickOutput']) {
    assert.equal(JSON.parse(cancelled.api[name]()), null);
  }
});

test('native host exceptions containing JSON controls are returned without breaking the protocol', () => {
  const message = '選択失敗 "素材"\n\r\t\u0000\u001f\\path';
  const env = setup({ dialogError: new Error(message) });
  const result = JSON.parse(env.api.pickMedia());
  assert.equal(result.ok, false);
  assert.equal(result.error, message);
});

test('import uses the selected bin, preserves literal paths, and falls back to the root bin', () => {
  for (const rootBin of [false, true]) {
    const env = setup({ rootBin });
    assert.equal(JSON.parse(env.api.importRendered(env.sourcePath)).ok, true);
    assert.deepEqual(env.imports[0], {
      files: [env.sourcePath], suppressUI: true,
      bin: rootBin ? env.root : env.selected, numberedStills: false
    });
  }
});

test('missing project, missing output and import failures are reported without a false success', () => {
  for (const [options, pattern] of [
    [{ noProject: true }, /プロジェクトを開いて/],
    [{ exists: false }, /見つかりません/],
    [{ importSuccess: false }, /読み込みに失敗/]
  ]) {
    const env = setup(options);
    const result = JSON.parse(env.api.importRendered(env.sourcePath));
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
    if (options.noProject || options.exists === false) assert.equal(env.imports.length, 0);
  }
});

test('folder reveal opens only the parent of an existing movie without requiring a Premiere project', () => {
  const env = setup({ noProject: true });
  const result = JSON.parse(env.api.revealOutput(env.sourcePath));
  assert.equal(result.ok, true);
  assert.equal(result.folderPath, path.win32.dirname(env.sourcePath));
  assert.deepEqual(env.opened, [path.win32.dirname(env.sourcePath)]);
  assert.equal(env.imports.length, 0);
});

test('folder reveal rejects missing outputs, missing parent folders and execution failures', () => {
  for (const options of [{ exists: false }, { folderExists: false }, { folderExecute: false }]) {
    const env = setup(options);
    const result = JSON.parse(env.api.revealOutput(env.sourcePath));
    assert.equal(result.ok, false);
    assert.match(result.error, /見つかりません|開けません/);
    assert.equal(env.imports.length, 0);
    if (options.exists === false || options.folderExists === false) assert.equal(env.opened.length, 0);
  }
});
