(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardTitleDrop = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function pathFrom(transfer) {
    // Premiere's timeline payload is not a file. Never use the currently
    // selected clip, text/uri-list or an unknown native payload as a substitute.
    var files = transfer && transfer.files;
    if (!files || !files.length) throw new Error('タイムラインのクリップは直接登録できません。Premiereで.mogrtとして書き出し、そのファイルをドロップしてください。');
    if (files.length !== 1) throw new Error('.mogrtファイルを1つずつドロップしてください。');
    var file = files[0];
    if (!file || typeof file.name !== 'string' || !/\.mogrt$/i.test(file.name)) throw new Error('登録できるのは.mogrtファイルです。画像・動画ではなく、書き出したテンプレートを選んでください。');
    if (typeof file.size === 'number' && file.size > 256 * 1024 * 1024) throw new Error('256MB以下の.mogrtファイルを選んでください。');
    if (typeof file.path !== 'string' || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(file.path) || /[\u0000-\u001f]/.test(file.path) || file.path.length > 32768) throw new Error('ファイルの場所を取得できません。Premiere内のパネルで「.mogrtを選択」を使ってください。');
    return file.path;
  }
  return { pathFrom: pathFrom };
}));
