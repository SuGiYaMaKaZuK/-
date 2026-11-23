(function () {
  'use strict';
  var cepFileType = /^com\.adobe\.cep\.dnd\.file\.(\d+)$/i;
  function offered(transfer) {
    return transfer && (Array.from(transfer.types || []).some(function (type) {
      return type === 'Files' || type === 'text/uri-list' || cepFileType.test(type);
    }) || (transfer.files && transfer.files.length));
  }
  function pathHints(transfer) {
    var types = Array.from(transfer.types || []).filter(function (type) { return cepFileType.test(type); });
    if (types.length) {
      types.sort(function (a, b) { return Number(a.match(cepFileType)[1]) - Number(b.match(cepFileType)[1]); });
      return types.map(function (type) { return transfer.getData(type); });
    }
    var lines = (transfer.getData('text/uri-list') || '').split(/\r?\n/).filter(function (line) { return line && !line.startsWith('#'); });
    if (lines.some(function (line) { return !/^file:/i.test(line); })) throw new Error('エクスプローラーから画像・動画ファイルをドロップしてください。');
    return lines;
  }
  function read(transfer, options) {
    var bridge = window.CardBridge, entries = Array.from(transfer.items || []), files = Array.from(transfer.files || []);
    if (entries.some(function (item) {
      var entry = item.kind === 'file' && item.webkitGetAsEntry && item.webkitGetAsEntry();
      return entry && entry.isDirectory;
    })) throw new Error('フォルダーを開き、中の画像・動画ファイルをドロップしてください。');
    if (!files.length) files = entries.filter(function (item) { return item.kind === 'file'; }).map(function (item) { return item.getAsFile(); }).filter(Boolean);
    var hints = bridge.hasHost && (!files.length || files.some(function (file) { return !file.path; })) ? pathHints(transfer) : [];
    var count = files.length || hints.length;
    if (!count) throw new Error('エクスプローラーから画像・動画ファイルをドロップしてください。');
    if (!options.multiple && count !== 1) throw new Error('この枠には画像か動画を1ファイルずつドロップしてください。');
    if (!files.length) return hints.map(function (path) { return bridge.droppedMedia(path, false); });
    return files.map(function (file, index) {
      var type = bridge.mediaTypeForName(file.name);
      if (file.size === 0) throw new Error('「' + file.name + '」は空のファイルです。素材を確認してください。');
      if (bridge.hasHost) {
        var path = file.path || (hints.length === count && hints[index]);
        if (path) {
          var info = bridge.droppedMedia(path, true);
          if (info.name.toLowerCase() === file.name.toLowerCase()) return info;
        }
        throw new Error('元ファイルの場所を取得できません。エクスプローラーからドロップするか、素材選択ボタンを使ってください。');
      }
      if (options.persistent) throw new Error('素材を登録するには、Premiere Pro内のパネルにファイルをドロップしてください。');
      return { path: '', type: type, name: file.name, url: URL.createObjectURL(file), objectURL: true };
    });
  }
  function bind(container, options) {
    var highlighted = null;
    function clear() {
      if (highlighted) highlighted.classList.remove('file-drag-over');
      highlighted = null;
    }
    function locate(event) { return options.available() && options.target(event.target); }
    function over(event) {
      var target = locate(event);
      if (!target || !offered(event.dataTransfer)) { clear(); return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (target !== highlighted) { clear(); highlighted = target; target.classList.add('file-drag-over'); }
    }
    container.addEventListener('dragenter', over);
    container.addEventListener('dragover', over);
    container.addEventListener('dragleave', function (event) {
      if (highlighted && !highlighted.contains(event.relatedTarget)) clear();
    });
    container.addEventListener('drop', function (event) {
      var target = locate(event);
      clear();
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      try { options.receive(read(event.dataTransfer, options), target); }
      catch (error) { options.error(error); }
    });
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear, true);
    window.addEventListener('blur', clear);
  }
  window.CardMediaDrop = { bind: bind };
}());
