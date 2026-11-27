'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const bridgeSource = fs.readFileSync(path.join(__dirname, '../js/bridge.js'), 'utf8');
const modelSource = fs.readFileSync(path.join(__dirname, '../js/model.js'), 'utf8');

function setup(options = {}) {
  const root = options.root || path.resolve('/tmp/カード %20 "演出"\u2028');
  const rendered = [], imported = [], loaded = [], scripts = [], writes = [], opened = [];
  const projectPath = path.resolve('/tmp/カード設定.json');
  const host = Object.assign({
    pickMedia: () => JSON.stringify(path.resolve('/tmp/ボス "最終形態".mp4')),
    pickSaveProject: () => JSON.stringify(projectPath),
    pickLoadProject: () => JSON.stringify(projectPath),
    pickOutput: () => JSON.stringify(path.resolve('/tmp/演出 "完成"\u2028.mov')),
    importRendered: file => { imported.push(file); return '{"ok":true}'; },
    revealOutput: file => { opened.push(file); return JSON.stringify({ ok: true, folderPath: path.dirname(file) }); }
  }, options.host);
  const fakeFS = {
    existsSync: file => file === path.join(root, 'bin', 'ffmpeg.exe'),
    statSync: () => ({ size: 200, isFile: () => true }),
    writeFileSync: (file, value, encoding) => writes.push({ file, value, encoding }),
    readFileSync: () => '\uFEFF' + JSON.stringify(context.window.CardModel.createProject())
  };
  Object.assign(fakeFS, options.fs);
  const nodeRequire = name => {
    if (name === 'fs') return fakeFS;
    if (name === 'path') return path;
    if (name === 'url') return url;
    if (name === 'process') return { env: {}, platform: 'win32' };
    if (name === path.join(root, 'js', 'render.js')) return {
      render: async (project, settings) => {
        rendered.push({ project, settings });
        if (options.render) return options.render(project, settings);
      }
    };
    throw new Error('Unexpected require: ' + name);
  };
  const window = {
    __adobe_cep__: {
      getSystemPath: kind => {
        assert.equal(kind, 'extension');
        return options.nativePath ? root : url.pathToFileURL(root).href;
      },
      evalScript: (script, callback) => {
        scripts.push(script);
        const run = () => {
          try {
            const result = vm.runInNewContext(script, {
              $: { evalFile: file => loaded.push(file.fsName) },
              File: function (file) { this.fsName = file; },
              CardReveal: host
            });
            callback(result);
          } catch (_) { callback('EvalScript error.'); }
        };
        if (options.deferDialog && script.includes('CardReveal.pickOutput(')) options.deferDialog.push(run);
        else run();
      }
    }
  };
  if (options.nativeDialog) window.cep = { fs: { showOpenDialog: options.nativeDialog } };
  if (!options.globalRequire) window.cep_node = { require: nodeRequire };
  // CEP mixed context exposes both window and Node's module/require globals.
  const context = vm.createContext({ window, module: { exports: {} }, require: nodeRequire, AbortController, console });
  vm.runInContext(modelSource, context);
  assert.equal(context.window.CardModel, context.module.exports);
  vm.runInContext(bridgeSource, context);
  return { api: window.CardBridge, model: window.CardModel, loaded, scripts, writes, rendered, imported, opened, root };
}

test('sample projects use bundled native media paths and start from fresh editable settings', async () => {
  const env = setup();
  const project = await env.api.sampleProject();
  assert.deepEqual(Array.from(project.cards, card => card.name), ['ボス', '宝箱', '次の冒険']);
  assert.deepEqual(Array.from(project.cards, card => card.mediaPath), ['boss.png', 'treasure.png', 'quest.png'].map(file => path.join(env.root, 'examples', 'media', file)));
  assert.ok(project.cards.every(card => card.mediaType === 'image'));
  assert.equal(env.model.validate(project).length, 0);
  project.cards[0].name = '編集後';
  assert.equal((await env.api.sampleProject()).cards[0].name, 'ボス');
  const four = await env.api.sampleProject('quad');
  assert.equal(four.mode, 'quad');
  assert.equal(four.cards[3].mediaPath, path.join(env.root, 'examples', 'media', 'portal.png'));
  const halves = await env.api.sampleProject('half');
  assert.equal(halves.mode, 'half');
  assert.deepEqual(Array.from(halves.cards, card => card.mediaPath), Array.from(project.cards.slice(0, 2), card => card.mediaPath));
  assert.equal(env.scripts.length, 0);
});

test('browser-only preview can load bundled samples without any CEP or Node globals', async () => {
  const window = { location: { href: 'https://example.test/カード演出/index.html' } };
  const context = vm.createContext({ window, URL });
  vm.runInContext(modelSource, context);
  vm.runInContext(bridgeSource, context);
  assert.equal(window.CardBridge.hasHost, false);
  const project = await window.CardBridge.sampleProject();
  const expected = ['boss.png', 'treasure.png', 'quest.png'].map(file => new URL('examples/media/' + file, window.location.href).href);
  assert.deepEqual(Array.from(project.cards, card => card.mediaPath), expected);
  assert.equal(window.CardModel.validate(project).length, 0);
  assert.equal(window.CardBridge.importRendered, undefined);
  assert.equal(window.CardBridge.openOutputFolder, undefined);
});

test('CEP native media picker opens directly without loading an ExtendScript dialog', async () => {
  for (const [filename,type] of [['紹介画像.PNG','image'],['ボス動画.MP4','video']]) {
    const filenamePath=path.resolve('/tmp',filename);
    const env=setup({nativeDialog:(multiple,directory,title,initial,extensions)=>{
      assert.equal(multiple,false); assert.equal(directory,false);
      assert.ok(title.includes('画像')); assert.equal(initial,'');
      assert.ok(extensions.includes('png') && extensions.includes('mp4'));
      assert.ok(extensions.every(ext=>!ext.startsWith('.')));
      return {err:0,data:[filenamePath]};
    }});
    const media=await env.api.pickMedia();
    assert.equal(media.path,filenamePath); assert.equal(media.type,type);
    assert.equal(url.fileURLToPath(media.url),filenamePath);
    assert.equal(env.scripts.length,0);
  }
});

test('native dialog cancellation stays cancelled and picker failures are visible', async () => {
  const env=setup({nativeDialog:()=>({err:0,data:[]})});
  assert.equal(await env.api.pickMedia(),null);
  assert.equal(env.scripts.length,0);
  const broken=setup({nativeDialog:()=>({err:2,data:[]})});
  await assert.rejects(broken.api.pickMedia(),/CEPエラー 2/);
  assert.equal(broken.scripts.length,0);
});

test('CEP mixed context loads the model and file URI roots without corrupting Japanese, quotes or percent names', async () => {
  const env = setup();
  assert.equal(env.api.hasHost, true);
  const media = await env.api.pickMedia();
  assert.equal(media.type, 'video');
  assert.equal(url.fileURLToPath(media.url), media.path);
  assert.equal(env.loaded[0], path.join(env.root, 'js', 'host.jsx'));
  assert.ok(env.scripts[0].includes('\\u2028'));
  assert.equal(/[\u2028\u2029]/.test(env.scripts[0]), false);
});

test('native CEP root paths keep literal %20 and work with global Node require fallback', async () => {
  const env = setup({ nativePath: true, globalRequire: true });
  await env.api.pickMedia();
  assert.equal(env.loaded[0], path.join(env.root, 'js', 'host.jsx'));
});

test('host errors, EvalScript failure and valid JSON with the wrong protocol shape are rejected', async () => {
  for (const [response, message] of [
    ['{"ok":false,"error":"素材を選択できません\\nやり直してください"}', /素材を選択できません/],
    ['EvalScript error.', /ホストスクリプト/],
    ['{"ok":true}', /不正なファイル選択/],
    ['not JSON', /Premiere Pro:/]
  ]) {
    const env = setup({ host: { pickMedia: () => response } });
    await assert.rejects(env.api.pickMedia(), message);
  }
});

test('cancelled output dialogs do not launch FFmpeg and release the render lock', async () => {
  const pending = [];
  const env = setup({ deferDialog: pending, host: { pickOutput: () => 'null' } });
  const first = env.api.render(env.model.createProject());
  await assert.rejects(env.api.render(env.model.createProject()), /書き出し中/);
  pending.shift()();
  assert.equal(await first, null);
  assert.equal(env.rendered.length, 0);
  assert.equal(env.imported.length, 0);
  const second = env.api.render(env.model.createProject());
  pending.shift()();
  assert.equal(await second, null);
});

test('cancelling while a dialog is open never starts a render when the dialog returns', async () => {
  const pending = [];
  const env = setup({ deferDialog: pending });
  const result = env.api.render(env.model.createProject());
  env.api.cancelRender();
  pending.shift()();
  assert.equal(await result, null);
  assert.equal(env.rendered.length, 0);
});

test('render captures a settings snapshot while the native save dialog is open', async () => {
  const pending = [], env = setup({deferDialog:pending});
  const project = env.model.createProject(), requestedWidth = project.width;
  const result = env.api.render(project);
  project.width = 320;
  project.cards[0].flipAt = 20;
  pending.shift()();
  await result;
  assert.equal(env.rendered[0].project.width,requestedWidth);
  assert.equal(env.rendered[0].project.cards[0].flipAt,1.8);
});

test('completed movie paths survive ExtendScript quoting; import failure preserves the rendered asset', async () => {
  const env = setup();
  const success = await env.api.render(env.model.createProject());
  assert.equal(success.imported, true);
  assert.equal(env.imported[0], env.rendered[0].settings.outputPath);
  assert.equal(success.outputPath, env.imported[0]);
  assert.equal(/[\u2028\u2029]/.test(env.scripts[1]), false);

  const failed = setup({ host: { importRendered: () => '{"ok":false,"error":"プロジェクト未選択"}' } });
  const result = await failed.api.render(failed.model.createProject());
  assert.equal(failed.rendered.length, 1);
  assert.equal(result.imported, false);
  assert.match(result.importError, /プロジェクト未選択/);

  const malformed = setup({ host: { importRendered: () => 'null' } });
  const malformedResult = await malformed.api.render(malformed.model.createProject());
  assert.equal(malformedResult.imported, false);
  assert.match(malformedResult.importError, /完了を確認できません/);
});

test('project loading handles UTF-8 BOM and validates settings before returning them', async () => {
  const env = setup();
  const project = await env.api.loadProject();
  assert.equal(project.cards.length, 3);
  assert.equal(project.width, 1920);
  const broken = setup({ fs: { readFileSync: () => '{"cards":[null]}' } });
  await assert.rejects(broken.api.loadProject());
});

test('import retry and opening the containing folder use host APIs with safely serialized paths', async () => {
  const env = setup();
  const output = path.resolve('/tmp/紹介 "ボス"\u2029.mov');
  const retry = await env.api.importRendered(output);
  assert.equal(retry.imported, true);
  assert.equal(retry.outputPath, output);
  assert.equal(env.imported[0], output);
  assert.equal(await env.api.openOutputFolder(output), path.dirname(output));
  assert.equal(env.opened[0], output);
  assert.equal(env.rendered.length, 0);
  assert.ok(env.scripts.every(script => !/[\u2028\u2029]/.test(script)));
  await assert.rejects(env.api.importRendered('relative.mov'), /保存先を確認/);
  await assert.rejects(env.api.openOutputFolder('file:///tmp/movie.mov'), /保存先を確認/);
});

test('retry and folder host failures are surfaced instead of reporting success', async () => {
  const output = path.resolve('/tmp/紹介.mov');
  const failed = setup({ host: {
    importRendered: () => '{"ok":false,"error":"プロジェクトを開いてください"}',
    revealOutput: () => '{"ok":false,"error":"フォルダーを開けません"}'
  } });
  await assert.rejects(failed.api.importRendered(output), /プロジェクトを開いて/);
  await assert.rejects(failed.api.openOutputFolder(output), /フォルダーを開けません/);
  const malformed = setup({ host: { revealOutput: () => 'null' } });
  await assert.rejects(malformed.api.openOutputFolder(output), /表示を確認できません/);
});

test('dropped files and local file URIs give the renderer a durable native path, including literal %, # and Japanese names', () => {
  const { api } = setup(), media = path.resolve('/tmp/素材 # 100%20.MP4');
  const direct = api.droppedMedia(media, true), uri = api.droppedMedia(url.pathToFileURL(media).href, false);
  assert.deepEqual(direct, uri);
  assert.equal(direct.path, media); assert.equal(direct.type, 'video'); assert.equal(direct.url, url.pathToFileURL(media).href);
  assert.equal(api.mediaTypeForName('表紙.TIFF'), 'image');
  assert.throws(() => api.droppedMedia('相対.png', true), /場所/);
  assert.throws(() => api.droppedMedia('https://example.test/a.png', true), /場所/);
  assert.throws(() => api.droppedMedia(path.resolve('/tmp/note.txt'), true), /対象外/);
  assert.throws(() => setup({ fs: { statSync: () => ({ isFile: () => false }) } }).api.droppedMedia(url.pathToFileURL(media).href, false), /読み取れません/);
});
