(function () {
  'use strict';
  var Lib = window.CardLibrary, Library = window.CardLibraryPanel, Panel = window.CardPanel, Bridge = window.CardBridge;
  var $ = function (id) { return document.getElementById(id); };
  var draft = null, baseline = null, chosen = null, preserved = null, saving = false, choosing = false, inserting = false, generation = 0, lastInsert = 0;
  function status(message, error) {
    $('status-text').textContent = message; $('status-text').title = message; $('status').classList.toggle('error', !!error);
    $('editor-status').textContent = message; $('editor-status').classList.toggle('error', !!error);
  }
  function message(error) {
    if (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014) return '保存容量がいっぱいです。不要な保存データを整理してから、もう一度保存してください。';
    return error.message || String(error);
  }
  function option(select, value, label) { var el = document.createElement('option'); el.value = value; el.textContent = label; select.appendChild(el); }
  function sync() {
    var busy = Panel.isBusy() || inserting, unavailable = !Library.isAvailable();
    $('register-title').disabled = busy || unavailable;
    document.querySelectorAll('[data-insert-title]').forEach(function (button) { button.disabled = busy || unavailable || !Bridge.hasHost; });
    document.querySelectorAll('[data-manage-title]').forEach(function (button) { button.disabled = busy || unavailable; });
    $('pick-title-template').disabled = busy || saving || choosing || !Bridge.hasHost;
    $('save-title').disabled = busy || saving || choosing || unavailable || !Bridge.hasHost || !(chosen || draft && draft.templatePath);
    $('delete-title').disabled = busy || saving || choosing || unavailable;
    ['title-name', 'title-group', 'title-video-track'].forEach(function (id) { $(id).disabled = saving || choosing || busy; });
    $('title-dialog').querySelector('[data-close-dialog]').disabled = saving || choosing;
    $('save-title').textContent = saving ? '保存中…' : draft && draft.id ? '登録内容を保存' : 'MAINに登録';
  }
  async function open(id) {
    if (Panel.isBusy() || inserting || !Library.isAvailable()) return;
    var state = Library.getState(), existing = (state.titles || []).find(function (t) { return t.id === id; });
    if (id && !existing) { status('保存したテロップが見つかりません。', true); return; }
    var token = ++generation;
    draft = existing ? Lib.clone(existing) : { name: '', groupId: state.activeGroupId, videoTrack: 'auto' };
    baseline = existing ? JSON.stringify(existing) : null; chosen = null; preserved = null;
    $('title-dialog-heading').textContent = existing ? 'テロップの登録設定' : 'いつものテロップを登録';
    $('title-export-help').open = !existing; $('title-name').value = draft.name; $('title-group').textContent = '';
    state.groups.forEach(function (g) { option($('title-group'), g.id, g.name); }); $('title-group').value = draft.groupId;
    $('title-video-track').textContent = ''; option($('title-video-track'), 'auto', '自動・空いている最上段');
    if (draft.videoTrack !== 'auto') option($('title-video-track'), String(draft.videoTrack), 'V' + (draft.videoTrack + 1) + '（保存した挿入先）');
    $('title-video-track').value = String(draft.videoTrack);
    $('title-file-name').textContent = existing ? draft.sourceName || '登録済みの.mogrt' : 'ファイルが選ばれていません';
    $('title-error').textContent = ''; $('delete-title').hidden = !existing;
    $('title-context-note').textContent = Bridge.hasHost ? '挿入先のシーケンスを確認しています…' : 'ファイルの登録・挿入はPremiere内のパネルで利用できます。';
    if (!$('title-dialog').open) $('title-dialog').showModal(); sync(); $('title-name').focus();
    if (!Bridge.hasHost || typeof Bridge.titleContext !== 'function') return;
    try {
      var context = await Bridge.titleContext();
      if (generation !== token || !$('title-dialog').open) return;
      var value = $('title-video-track').value; $('title-video-track').textContent = '';
      option($('title-video-track'), 'auto', '自動・空いている最上段');
      context.videoTracks.forEach(function (track) { option($('title-video-track'), String(track.index), 'V' + (track.index + 1) + ' · ' + track.name); });
      if (value !== 'auto' && !context.videoTracks.some(function (t) { return String(t.index) === value; })) option($('title-video-track'), value, 'V' + (Number(value) + 1) + '（現在のシーケンスにありません）');
      $('title-video-track').value = value;
      $('title-context-note').textContent = context.sequenceName ? '現在のシーケンス：' + context.sequenceName + '。挿入時の再生ヘッド位置を使います。' : '登録は先にできます。挿入する時はPremiereでシーケンスを開いてください。';
    } catch (error) {
      if (generation === token) $('title-context-note').textContent = 'トラック情報を取得できませんでした。自動で登録し、挿入前にシーケンスを開いてください。';
    }
  }
  $('register-title').addEventListener('click', function () { open(); });
  $('pick-title-template').addEventListener('click', async function () {
    if (!draft || saving || choosing || inserting || Panel.isBusy() || !Bridge.hasHost) return;
    choosing = true; sync(); $('title-error').textContent = '';
    try {
      var selected = await Bridge.pickTitleTemplate(); if (!selected) return;
      chosen = selected; preserved = null; $('title-file-name').textContent = selected.sourceName;
      if (!$('title-name').value.trim()) {
        var names = Library.getState().presets.concat(Library.getState().titles || []).filter(function (t) { return t.groupId === $('title-group').value; }).map(function (t) { return t.name; });
        $('title-name').value = Lib.availableName(selected.sourceName.replace(/\.mogrt$/i, ''), names);
      }
    } catch (error) { $('title-error').textContent = message(error); }
    finally { choosing = false; sync(); }
  });
  $('title-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (!draft || saving || choosing || inserting || Panel.isBusy() || !Bridge.hasHost) return;
    var track = $('title-video-track').value;
    var record = { id: draft.id, name: $('title-name').value, groupId: $('title-group').value, videoTrack: track === 'auto' ? 'auto' : Number(track), templatePath: chosen ? chosen.path : draft.templatePath, sourceName: chosen ? chosen.sourceName : draft.sourceName };
    saving = true; sync(); $('title-error').textContent = '';
    try {
      // Reject bad names/groups before copying. Retry after quota errors reuses
      // the same preserved binary and never overwrites the source template.
      Lib.saveTitle(Library.getState(), record);
      if (chosen) { if (!preserved) preserved = await Bridge.preserveTitleTemplate(chosen.path); record.templatePath = preserved.templatePath; record.sourceName = preserved.sourceName; }
      var saved = Library.commit(function (next) {
        if (record.id && JSON.stringify((next.titles || []).find(function (t) { return t.id === record.id; })) !== baseline) throw new Error('このテロップの登録は別の画面で更新されています。一度閉じて、登録設定を開き直してください。');
        return Lib.saveTitle(next, record);
      });
      $('main-search').value = ''; $('main-search').dispatchEvent(new Event('input'));
      $('title-dialog').close(); status('「' + saved.name + '」をMAINに登録しました。サムネイルから1クリックで挿入できます。');
    } catch (error) { $('title-error').textContent = message(error); }
    finally { saving = false; sync(); }
  });
  $('delete-title').addEventListener('click', function () {
    if (!draft || !draft.id || saving || choosing || inserting || Panel.isBusy() || !window.confirm('「' + draft.name + '」の登録を削除しますか？ 挿入済みのテロップと元のファイルは残ります。')) return;
    try { Library.commit(function (next) { Lib.removeTitle(next, draft.id); }); $('title-dialog').close(); status('テロップの登録を削除しました。'); }
    catch (error) { $('title-error').textContent = message(error); }
  });
  async function insert(id) {
    if (inserting || saving || choosing || Panel.isBusy() || Date.now() - lastInsert < 600) return;
    if (!Bridge.hasHost) { status('テロップの挿入はPremiere内で利用できます。', true); return; }
    var record = (Library.getState().titles || []).find(function (t) { return t.id === id; }); if (!record) return;
    inserting = true; lastInsert = Date.now(); window.dispatchEvent(new CustomEvent('cardreveal:title-busy', { detail: { busy: true } })); sync();
    status('「' + record.name + '」を挿入しています…');
    try {
      var result = await Bridge.insertTitle(Lib.clone(record));
      if (result.verified) status('「' + record.name + '」をV' + (result.videoTrack + 1) + 'の再生ヘッド位置に挿入しました。Premiereで文字を編集できます。');
      else status('挿入処理は返りましたが、配置を確認できませんでした。再度押す前にPremiereのタイムラインを確認してください。', true);
    } catch (error) { status(message(error), true); }
    finally { inserting = false; lastInsert = Date.now(); window.dispatchEvent(new CustomEvent('cardreveal:title-busy', { detail: { busy: false } })); sync(); }
  }
  $('saved-gallery').addEventListener('click', function (event) {
    var button = event.target.closest('[data-insert-title]'), settings = event.target.closest('[data-manage-title]');
    if (button && !button.disabled) insert(button.dataset.insertTitle); else if (settings && !settings.disabled) open(settings.dataset.manageTitle);
  });
  $('title-dialog').addEventListener('click', function (event) { if ((saving || choosing) && event.target.closest('[data-close-dialog]')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  $('title-dialog').addEventListener('cancel', function (event) { if (saving || choosing) event.preventDefault(); });
  $('title-dialog').addEventListener('close', function () { generation++; draft = null; baseline = null; chosen = null; preserved = null; });
  document.addEventListener('keydown', function (event) { if ($('title-dialog').open && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!saving && !choosing) $('title-form').requestSubmit(); } });
  window.addEventListener('cardreveal:library-changed', sync); window.addEventListener('cardreveal:busy', sync); sync();
}());
