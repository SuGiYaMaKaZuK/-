(function () {
  'use strict';
  var api = window.CardBridge = { hasHost: false };
  api.sampleProject = async function () {
    var project = window.CardModel.createProject();
    var examples = [
      { file: 'boss.png', name: 'ボス' },
      { file: 'treasure.png', name: '宝箱' },
      { file: 'quest.png', name: '次の冒険' }
    ];
    project.cards.forEach(function (card, index) {
      card.name = examples[index].name;
      card.mediaType = 'image';
      card.mediaPath = api.hasHost ? path.join(root, 'examples', 'media', examples[index].file) : new URL('examples/media/' + examples[index].file, window.location.href).href;
    });
    return project;
  };
  var nodeRequire = window.cep_node && window.cep_node.require ? window.cep_node.require : (typeof require === 'function' ? require : null);
  if (!window.__adobe_cep__ || !nodeRequire) return;
  var fs, path, nodeURL, root, nodeProcess;
  try {
    fs = nodeRequire('fs'); path = nodeRequire('path'); nodeURL = nodeRequire('url'); nodeProcess = nodeRequire('process');
    var raw = window.__adobe_cep__.getSystemPath('extension');
    // CEP normally returns a file URI. Native paths must not be URI-decoded:
    // a real folder named "100%" or "%20" is a valid Windows folder name.
    root = /^file:/i.test(raw) ? nodeURL.fileURLToPath(raw) : raw;
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('拡張フォルダーを確認できません。');
    api.hasHost = true;
  } catch (error) { console.error('CEP initialization', error); return; }
  var activeController = null, activeTitleInsertion = false;
  function scriptArgument(value) {
    // ExtendScript is ES3; unlike modern JS it treats these Unicode characters
    // as line breaks inside string literals, even when JSON.stringify emits them.
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function host(method, args) {
    return new Promise(function (resolve, reject) {
      var script = '$.evalFile(new File(' + scriptArgument(path.join(root, 'js', 'host.jsx')) + ')); CardReveal.' + method + '(' + (args || []).map(scriptArgument).join(',') + ');';
      window.__adobe_cep__.evalScript(script, function (result) {
        try {
          var value = JSON.parse(result);
          if (value && value.ok === false) throw new Error(value.error || 'Premiere Proとの通信に失敗しました。');
          if (/^pick/.test(method) && value !== null && typeof value !== 'string') throw new Error('ホストから不正なファイル選択結果が返されました。');
          if (method === 'importRendered' && (!value || value.ok !== true)) throw new Error('ホストから読み込みの完了を確認できませんでした。');
          if (method === 'revealOutput' && (!value || value.ok !== true)) throw new Error('ホストからフォルダーの表示を確認できませんでした。');
          if (method === 'titleContext' && (!value || value.ok !== true || !Array.isArray(value.videoTracks))) throw new Error('ホストからトラック情報を確認できませんでした。');
          if (method === 'insertTitle' && (!value || value.ok !== true || value.inserted !== true || typeof value.verified !== 'boolean' || !Number.isInteger(value.videoTrack) || value.videoTrack < 0 || typeof value.startTicks !== 'string' || !/^\d+$/.test(value.startTicks))) throw new Error('ホストから挿入の完了を確認できませんでした。タイムラインを確認してください。');
          resolve(value);
        } catch (error) { reject(new Error('Premiere Pro: ' + (result === 'EvalScript error.' ? 'ホストスクリプトを実行できませんでした。' : error.message))); }
      });
    });
  }
  function classify(filePath) {
    var ext = path.extname(filePath).toLowerCase();
    if (/^\.(png|jpe?g|webp|bmp|tiff?)$/.test(ext)) return 'image';
    if (/^\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|mxf)$/.test(ext)) return 'video';
    throw new Error('PNG・JPEGなどの画像、またはMP4・MOVなどの動画を選んでください。');
  }
  function ffmpegPath() {
    var candidates = [path.join(root, 'bin', 'ffmpeg.exe')];
    if (nodeProcess.env.CARD_REVEAL_FFMPEG) candidates.push(nodeProcess.env.CARD_REVEAL_FFMPEG);
    (nodeProcess.env.PATH || nodeProcess.env.Path || '').split(path.delimiter).forEach(function (dir) {
      if (dir) candidates.push(path.join(dir.replace(/^"|"$/g, ''), nodeProcess.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
    });
    for (var i = 0; i < candidates.length; i++) if (fs.existsSync(candidates[i]) && fs.statSync(candidates[i]).isFile()) return candidates[i];
    throw new Error('FFmpegが見つかりません。install-windows.ps1を実行し直すか、binフォルダーにffmpeg.exeを置いてPremiere Proを再起動してください。');
  }
  api.pickMedia = async function () {
    var result;
    var nativeFS = window.cep && window.cep.fs;
    if (nativeFS && typeof nativeFS.showOpenDialog === 'function') {
      // Use CEP's native picker directly. Premiere's ExtendScript File dialog
      // is not needed for selecting panel media.
      var selection = nativeFS.showOpenDialog(false, false, '画像または動画を選択', '', ['png','jpg','jpeg','webp','bmp','tif','tiff','mp4','mov','m4v','avi','mkv','webm','mts','m2ts','mxf']);
      if (!selection || selection.err !== 0 || !Array.isArray(selection.data)) throw new Error('ファイル選択画面を開けませんでした。パネルを閉じて開き直してください。' + (selection && typeof selection.err === 'number' ? '（CEPエラー ' + selection.err + '）' : ''));
      result = selection.data[0] || null;
    } else {
      result = await host('pickMedia');
    }
    if (!result) return null;
    return { path: result, type: classify(result), url: nodeURL.pathToFileURL(result).href, name: path.basename(result) };
  };
  api.mediaURL = function (filePath) { return nodeURL.pathToFileURL(filePath).href; };
  function titlePath(value) {
    if (typeof value !== 'string' || value.length > 32768 || !path.isAbsolute(value) || /[\u0000-\u001f]/.test(value) || path.extname(value).toLowerCase() !== '.mogrt') throw new Error('.mogrtファイルを選んでください。');
    var stat; try { stat = fs.statSync(value); } catch (error) { throw new Error('登録した.mogrtが見つからないか、読み取れません。ファイルを選び直してください。'); }
    if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024 * 1024) throw new Error('有効なテロップ用.mogrtファイルを選んでください（256MBまで）。');
    return value;
  }
  api.pickTitleTemplate = async function () {
    var result, nativeFS = window.cep && window.cep.fs;
    if (nativeFS && typeof nativeFS.showOpenDialog === 'function') {
      var selection = nativeFS.showOpenDialog(false, false, 'いつものテロップを保存した.mogrtを選択', '', ['mogrt']);
      if (!selection || selection.err !== 0 || !Array.isArray(selection.data)) throw new Error('テンプレートの選択画面を開けませんでした。');
      result = selection.data[0] || null;
    } else result = await host('pickTitleTemplate');
    if (!result) return null;
    return { path: titlePath(result), sourceName: path.basename(result) };
  };
  api.preserveTitleTemplate = async function (sourcePath) {
    sourcePath = titlePath(sourcePath);
    var raw = window.__adobe_cep__.getSystemPath('userData');
    var base = /^file:/i.test(raw) ? nodeURL.fileURLToPath(raw) : raw;
    if (typeof base !== 'string' || !path.isAbsolute(base)) throw new Error('テンプレートの保存先を確認できません。');
    var folder = path.join(base, 'CardRevealStudio', 'telop-templates');
    fs.mkdirSync(folder, { recursive: true });
    var destination = path.join(folder, 'telop-' + Date.now() + '-' + nodeRequire('crypto').randomBytes(8).toString('hex') + '.mogrt');
    fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
    return { templatePath: destination, sourceName: path.basename(sourcePath) };
  };
  api.titleContext = async function () { return await host('titleContext'); };
  api.inspectTitleTemplate = async function (sourcePath) {
    sourcePath = titlePath(sourcePath);
    return { path: sourcePath, sourceName: path.basename(sourcePath) };
  };
  api.insertTitle = async function (record) {
    if (activeTitleInsertion || activeController) throw new Error('ほかの作成・挿入処理が終わってから実行してください。');
    var sourcePath = titlePath(record && record.templatePath), track = record.videoTrack;
    if (track !== 'auto' && (!Number.isInteger(track) || track < 0 || track > 999)) throw new Error('挿入先のビデオトラックを確認してください。');
    activeTitleInsertion = true;
    try { return await host('insertTitle', [sourcePath, track]); } finally { activeTitleInsertion = false; }
  };
  function outputFilePath(outputPath) {
    if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || outputPath.indexOf('\u0000') !== -1) throw new Error('書き出した動画の保存先を確認できません。');
    return outputPath;
  }
  api.importRendered = async function (outputPath) {
    await host('importRendered', [outputFilePath(outputPath)]);
    return { outputPath: outputPath, imported: true };
  };
  api.openOutputFolder = async function (outputPath) {
    var result = await host('revealOutput', [outputFilePath(outputPath)]);
    return result.folderPath;
  };
  api.saveProject = async function (project) {
    var result = await host('pickSaveProject');
    if (!result) return null;
    if (path.extname(result).toLowerCase() !== '.json') result += '.json';
    fs.writeFileSync(result, JSON.stringify(project, null, 2), 'utf8');
    return result;
  };
  api.loadProject = async function () {
    var result = await host('pickLoadProject');
    if (!result) return null;
    if (fs.statSync(result).size > 1024 * 1024) throw new Error('設定ファイルが大きすぎます。');
    var value = JSON.parse(fs.readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
    var errors = window.CardModel.validate(value);
    if (errors.length) throw new Error(errors.join('\n'));
    return value;
  };
  api.render = async function (project, onProgress) {
    if (activeController) throw new Error('書き出し中です。完了またはキャンセルしてからお試しください。');
    if (activeTitleInsertion) throw new Error('テロップを挿入中です。完了してからお試しください。');
    var errors = window.CardModel.validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    // The native save dialog and encoder are asynchronous. Keep the settings
    // captured at the moment the user requests the movie.
    project = JSON.parse(JSON.stringify(project));
    // Hold the lock while the asynchronous native save dialog is open, too.
    activeController = new AbortController();
    try {
      var output = await host('pickOutput');
      if (!output || activeController.signal.aborted) return null;
      if (path.extname(output).toLowerCase() !== '.mov') output += '.mov';
      var normalized = path.resolve(output).toLowerCase();
      if (project.cards.some(function (card) { return card.mediaPath && path.resolve(card.mediaPath).toLowerCase() === normalized; })) throw new Error('元の素材と同じ場所には書き出せません。別の保存先を選んでください。');
      var ffmpeg = ffmpegPath();
      var renderer = nodeRequire(path.join(root, 'js', 'render.js'));
      await renderer.render(project, { ffmpegPath: ffmpeg, outputPath: output, onProgress: onProgress, signal: activeController.signal });
      try {
        await host('importRendered', [output]);
        return { outputPath: output, imported: true };
      } catch (error) { return { outputPath: output, imported: false, importError: error.message }; }
    } finally { activeController = null; }
  };
  api.cancelRender = function () { if (activeController) activeController.abort(); };
}());
