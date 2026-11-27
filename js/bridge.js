(function () {
  'use strict';
  var api = window.CardBridge = { hasHost: false };
  var connection = { version: '0.20.0', cepAvailable: !!(window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function'), nodeAvailable: false, ready: false, initializationError: null, lastRequest: null }, requestId = 0;
  api.mediaTypeForName = function (name) {
    if (/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name)) return 'image';
    if (/\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|mxf)$/i.test(name)) return 'video';
    throw new Error('「' + name + '」は対象外です。PNG・JPEGなどの画像、またはMP4・MOVなどの動画を選んでください。');
  };
  api.getHostStatus = function () { return JSON.parse(JSON.stringify(connection)); };
  function communicationError(message, code, stage) { var error = new Error(message); error.code = code; error.stage = stage; return error; }
  // Only read-only calls may time out and release the UI. A delayed write must
  // never allow another insertion/capture to start while Premiere is still busy.
  function readOnlyScript(script, method) {
    return new Promise(function (resolve, reject) {
      var id = ++requestId, started = Date.now(), settled = false, timer;
      function finish(error, value) {
        if (settled) return; settled = true; if (timer) clearTimeout(timer);
        if (id === requestId) connection.lastRequest = { method: method, state: error ? 'error' : 'complete', code: error ? error.code || 'HOST_ERROR' : null, stage: error ? error.stage || 'communication' : null, elapsedMs: Date.now() - started };
        if (error) reject(error); else resolve(value);
      }
      connection.lastRequest = { method: method, state: 'waiting', elapsedMs: 0 };
      if (!connection.cepAvailable) { finish(communicationError('Premiereとの接続がありません。ブラウザーではなく、Premiereの「ウィンドウ → エクステンション」からパネルを開いてください。', 'CEP_UNAVAILABLE', 'initialization')); return; }
      timer = setTimeout(function () { finish(communicationError('Premiereから10秒以内に応答がありませんでした。Premiere側のダイアログを閉じて、もう一度読み込んでください。「接続を確認」で通信状況を表示できます。', 'CEP_TIMEOUT', 'communication')); }, 10000);
      try { window.__adobe_cep__.evalScript(script, function (result) {
        if (result === 'EvalScript error.' || result === 'EvalScript error') finish(communicationError('Premiere内のスクリプトを実行できませんでした。「接続を確認」の結果と、このエラーをお知らせください。', 'CEP_SCRIPT_ERROR', 'execution'));
        else if (typeof result !== 'string' || !result.trim()) finish(communicationError('Premiereから空の応答が返されました。「接続を確認」をお試しください。', 'CEP_EMPTY_RESPONSE', 'response'));
        else finish(null, result);
      }); } catch (error) { finish(communicationError('Premiereへの通信を開始できませんでした。' + (error.message || String(error)), 'CEP_DISPATCH_ERROR', 'dispatch')); }
    });
  }
  api.testTimelineConnection = async function () {
    // No JSX file, Node.js or JSON object is required on the Premiere side.
    var script = '(function(){function q(v){return "\\\""+String(v).replace(/\\\\/g,"\\\\\\\\").replace(/"/g,"\\\\\\\"").replace(/[\\x00-\\x1f]/g,function(c){return "\\\\u"+("0000"+c.charCodeAt(0).toString(16)).slice(-4);})+"\\\"";}try{var p=app.project,s=p&&p.activeSequence,n=s?s.getSelection().length:0;return "{\\\"ok\\\":true,\\\"appVersion\\\":"+q(app.version)+",\\\"hasProject\\\":"+!!p+",\\\"hasSequence\\\":"+!!s+",\\\"selectionCount\\\":"+n+"}";}catch(e){return "{\\\"ok\\\":false,\\\"error\\\":"+q(e.message||e)+"}";}}())';
    var raw = await readOnlyScript(script, 'connection'), result;
    try { result = JSON.parse(raw); } catch (error) { throw communicationError('接続確認に不正な応答が返されました。', 'CEP_INVALID_RESPONSE', 'response'); }
    if (!result || result.ok !== true || typeof result.appVersion !== 'string' || typeof result.hasProject !== 'boolean' || typeof result.hasSequence !== 'boolean' || !Number.isInteger(result.selectionCount) || result.selectionCount < 0) throw communicationError(result && result.error ? 'Premiere: ' + result.error : '接続確認の結果を読み取れませんでした。', 'CEP_PROBE_ERROR', 'probe');
    return result;
  };
  api.sampleProject = async function (mode) {
    var project = window.CardModel.createProject(mode);
    var examples = [
      { file: 'boss.png', name: 'ボス' },
      { file: 'treasure.png', name: '宝箱' },
      { file: 'quest.png', name: '次の冒険' }
    ];
    if (mode === 'quad') {
      examples.push({ file:'portal.png', name:'ポータル' });
    }
    project.cards.forEach(function (card, index) {
      card.name = examples[index].name;
      card.mediaType = 'image';
      card.mediaPath = api.hasHost ? path.join(root, 'examples', 'media', examples[index].file) : new URL('examples/media/' + examples[index].file, window.location.href).href;
    });
    return project;
  };
  var nodeRequire = window.cep_node && window.cep_node.require ? window.cep_node.require : (typeof require === 'function' ? require : null);
  connection.nodeAvailable = !!nodeRequire;
  if (!connection.cepAvailable || !nodeRequire) { connection.initializationError = connection.cepAvailable ? 'Premiereは検出しましたが、ファイル機能（Node.js）が使えません。ZIPを展開してInstall.cmdで更新し、Premiereを再起動してください。' : 'Premiereとの接続がありません。Premiere内のエクステンションとして開いてください。'; return; }
  var fs, path, nodeURL, root, nodeProcess;
  try {
    fs = nodeRequire('fs'); path = nodeRequire('path'); nodeURL = nodeRequire('url'); nodeProcess = nodeRequire('process');
    var raw = window.__adobe_cep__.getSystemPath('extension');
    // CEP normally returns a file URI. Native paths must not be URI-decoded:
    // a real folder named "100%" or "%20" is a valid Windows folder name.
    root = /^file:/i.test(raw) ? nodeURL.fileURLToPath(raw) : raw;
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('拡張フォルダーを確認できません。');
    api.hasHost = true; connection.ready = true;
  } catch (error) { connection.initializationError = 'Premiereのファイル機能を初期化できませんでした。' + (error.message || String(error)); console.error('CEP initialization', error); return; }
  var activeController = null, activeTitleInsertion = false;
  function scriptArgument(value) {
    // ExtendScript is ES3; unlike modern JS it treats these Unicode characters
    // as line breaks inside string literals, even when JSON.stringify emits them.
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function host(method, args) {
    return new Promise(function (resolve, reject) {
      var trial = /^(trialSelection|trialCapture|trialInsert)$/.test(method);
      var script = '$.evalFile(new File(' + scriptArgument(path.join(root, 'js', trial ? 'timeline-host.jsx' : 'host.jsx')) + ')); ' + (trial ? 'CardTimelineTrial.' : 'CardReveal.') + method + '(' + (args || []).map(scriptArgument).join(',') + ');';
      var invoke = function (callback) { window.__adobe_cep__.evalScript(script, callback); };
      if (method === 'trialSelection') {
        var source; try { source = fs.readFileSync(path.join(root, 'js', 'timeline-host.jsx'), 'utf8').replace(/^\uFEFF/, ''); } catch (error) { throw communicationError('選択読み込み用のファイルが見つからないか、読み取れません。ZIPをすべて展開し、Install.cmdで更新してください。', 'CEP_SCRIPT_MISSING', 'load'); }
        // Send the bundled, verified source directly; this avoids a second
        // filesystem lookup through ExtendScript's File/$.evalFile.
        script = '(function(){\n' + source + '\nreturn CardTimelineTrial.trialSelection();\n}())';
        invoke = function (callback) { readOnlyScript(script, method).then(callback, reject); };
      }
      invoke(function (result) {
        try {
          var value = JSON.parse(result);
          if (value && value.ok === false) { var failure = new Error(value.error || 'Premiere Proとの通信に失敗しました。'); failure.stage=value.stage; throw failure; }
          if (/^pick/.test(method) && value !== null && typeof value !== 'string') throw new Error('ホストから不正なファイル選択結果が返されました。');
          if (method === 'importRendered' && (!value || value.ok !== true)) throw new Error('ホストから読み込みの完了を確認できませんでした。');
          if (method === 'revealOutput' && (!value || value.ok !== true)) throw new Error('ホストからフォルダーの表示を確認できませんでした。');
          if (method === 'titleContext' && (!value || value.ok !== true || !Array.isArray(value.videoTracks))) throw new Error('ホストからトラック情報を確認できませんでした。');
          if (method === 'insertTitle' && (!value || value.ok !== true || value.inserted !== true || typeof value.verified !== 'boolean' || !Number.isInteger(value.videoTrack) || value.videoTrack < 0 || typeof value.startTicks !== 'string' || !/^\d+$/.test(value.startTicks))) throw new Error('ホストから挿入の完了を確認できませんでした。タイムラインを確認してください。');
          if (method === 'trialSelection') { if (!value || value.ok !== true) throw new Error('選択クリップを確認できません。'); window.CardTimelineModel.validateCandidate(value.candidate); }
          if (method === 'trialCapture') { if (!value || value.ok !== true || (!Array.isArray(value.warnings) || !value.warnings.every(function(w){return typeof w==='string';}))) throw new Error('試験テロップの保管結果を確認できません。'); window.CardTimelineModel.validateTemplate(value.template); }
          if (method === 'trialInsert' && (!value || value.ok !== true || value.inserted !== true || typeof value.verified !== 'boolean' || !Number.isInteger(value.videoTrack) || value.videoTrack < 0 || !Number.isInteger(value.audioAdded) || value.audioAdded < 0 || typeof value.startTicks !== 'string' || !/^\d+$/.test(value.startTicks))) throw new Error('試験挿入の結果を確認できません。再度押す前にタイムラインを確認してください。');
          resolve(value);
        } catch (error) { var failure = new Error('Premiere Pro: ' + (result === 'EvalScript error.' ? 'ホストスクリプトを実行できませんでした。' : error.message)); if(error.stage)failure.stage=error.stage; else if(method==='trialSelection'){failure.stage='response';failure.code='CEP_INVALID_RESPONSE';} reject(failure); }
      });
    });
  }
  function localMedia(value) {
    var filePath = /^file:/i.test(value) ? nodeURL.fileURLToPath(value) : value;
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || /[\u0000-\u001f]/.test(filePath)) throw new Error('素材のファイルの場所を確認できません。');
    filePath = path.normalize(filePath);
    var name = path.basename(filePath);
    return { path: filePath, type: api.mediaTypeForName(name), url: nodeURL.pathToFileURL(filePath).href, name: name };
  }
  api.droppedMedia = function (value, fromFileList) {
    var info = localMedia(value);
    // When the drag only has a file URI, there is no OS File object to establish that it is a file.
    if (!fromFileList) {
      var regular = false;
      try { regular = fs.statSync(info.path).isFile(); } catch (error) {}
      if (!regular) throw new Error('「' + info.name + '」を読み取れません。エクスプローラーで元ファイルを確認してください。');
    }
    return info;
  };
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
    return localMedia(result);
  };
  api.previewAlpha = async function (filePath, size, time, signal) {
    if (!path.isAbsolute(filePath) || !Number.isInteger(size.width) || !Number.isInteger(size.height) ||
        size.width <= 0 || size.height <= 0 || size.width * size.height > 2000000 || !Number.isFinite(time) || time < 0) {
      throw new Error('プレビュー用の素材情報を確認できません。');
    }
    var decoder;
    if (/\.webm$/i.test(filePath)) {
      var file = await fs.promises.open(filePath, 'r');
      try {
        var header = nodeRequire('buffer').Buffer.alloc(65536);
        await file.read(header, 0, header.length, 0);
        if (header.includes('V_VP9')) decoder = 'libvpx-vp9';
        else if (header.includes('V_VP8')) decoder = 'libvpx';
      } finally { await file.close(); }
    }
    var reader = nodeRequire(path.join(root, 'js', 'alpha-source.js'));
    return reader.firstFrame({ ffmpegPath: ffmpegPath(), path: filePath, decoder: decoder, size: size, offset: time, displayFrame: true, signal: signal });
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
    var timeline = record && record.sourceType === 'timeline';
    var sourcePath = timeline ? timelinePath(record.templatePath) : titlePath(record && record.templatePath), track = record.videoTrack;
    if (timeline) window.CardTimelineModel.validateTemplate(record);
    if (track !== 'auto' && (!Number.isInteger(track) || track < 0 || track > 999)) throw new Error('挿入先のビデオトラックを確認してください。');
    activeTitleInsertion = true;
    try { return timeline ? await host('trialInsert', [sourcePath, record.sequenceId, track, { width: record.width, height: record.height, timebase: record.timebase, durationTicks: record.durationTicks }]) : await host('insertTitle', [sourcePath, track]); } finally { activeTitleInsertion = false; }
  };
  function timelinePath(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 32768 || /[\u0000-\u001f]/.test(value) || path.extname(value).toLowerCase() !== '.prproj') throw new Error('試験テロップの保管先を確認できません。');
    var stat; try { stat = fs.statSync(value); } catch (error) { throw new Error('保管した試験テロップが見つかりません。'); }
    if (!stat.isFile() || stat.size < 1 || stat.size > 256 * 1024 * 1024) throw new Error('試験テロップのプロジェクトを読み取れません（256MBまで）。');
    return value;
  }
  api.readTimelineCandidate = async function () {
    if (activeTitleInsertion || activeController) throw new Error('処理が終わってから、選択クリップを読み込んでください。');
    var value = await host('trialSelection'); return value.candidate;
  };
  api.preserveTimelineTitle = async function (candidate) {
    if (activeTitleInsertion || activeController) throw new Error('ほかの作成・挿入処理が終わってから実行してください。');
    window.CardTimelineModel.validateCandidate(candidate);
    var raw = window.__adobe_cep__.getSystemPath('userData'), base = /^file:/i.test(raw) ? nodeURL.fileURLToPath(raw) : raw;
    if (typeof base !== 'string' || !path.isAbsolute(base)) throw new Error('試験テロップの保管先を確認できません。');
    var folder = path.join(base, 'CardRevealStudio', 'timeline-titles'); fs.mkdirSync(folder, { recursive: true });
    var ownFolder = fs.mkdtempSync(path.join(folder, 'trial-')), destination = path.join(ownFolder, 'title.prproj');
    activeTitleInsertion = true;
    try {
      var value = await host('trialCapture', [candidate, destination]); timelinePath(destination);
      return { templatePath: destination, sourceName: value.template.sourceName || candidate.clipName, sequenceId: value.template.sequenceId, width: value.template.width, height: value.template.height, timebase: value.template.timebase, durationTicks: value.template.durationTicks, warnings: value.warnings };
    } catch (error) {
      // Only this newly allocated directory can be removed. Never remove an
      // original media path or another saved template on failure.
      try { fs.rmSync(ownFolder, { recursive: true, force: true }); } catch (ignored) {}
      throw error;
    } finally { activeTitleInsertion = false; }
  };
  api.saveTimelineTrialReport = async function (report) {
    var result = await host('pickTrialReport'); if (!result) return null;
    if (typeof result !== 'string' || !path.isAbsolute(result) || /[\u0000-\u001f]/.test(result)) throw new Error('診断JSONの保存先を確認できません。');
    if (path.extname(result).toLowerCase() !== '.json') result += '.json';
    var content = JSON.stringify(report, null, 2); if (content.length > 1024 * 1024) throw new Error('診断データが大きすぎます。');
    fs.writeFileSync(result, content, 'utf8'); return result;
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
