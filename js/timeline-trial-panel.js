(function () {
  'use strict';
  var Bridge = window.CardBridge, Model = window.CardTimelineModel, Lib = window.CardLibrary, Library = window.CardLibraryPanel, Panel = window.CardPanel;
  var $ = function (id) { return document.getElementById(id); };
  var busy = false, otherBusy = false, candidate = null, prepared = null, editing = null, baseline = null, records = [], last = null, dialogGeneration = 0;
  function enabled() { return $('timeline-trial-enabled').checked; }
  function log(value) { value.at = new Date().toISOString(); records.push(value); if (records.length > 40) records.shift(); }
  function status(value, error) { $('timeline-trial-state').textContent = value; $('timeline-trial-state').classList.toggle('error', !!error); $('status-text').textContent = value; $('status-text').title = value; $('status').classList.toggle('error', !!error); }
  function errorText(error) { if (error.name === 'QuotaExceededError' || error.code === 22) return '保存容量がいっぱいです。保管したファイルは保持しています。不要な保存データを整理して、再度登録してください。'; return error.message || String(error); }
  function phase(value) { busy = value; window.dispatchEvent(new CustomEvent('cardreveal:title-busy', { detail: { busy: value, owner: 'timeline-trial' } })); sync(); }
  function sync() {
    var locked = busy || otherBusy || Panel.isBusy(), available = Library.isAvailable();
    $('timeline-trial-enabled').disabled = locked || !Bridge.hasHost;
    $('timeline-trial-selection').disabled = locked || !enabled() || !Bridge.hasHost || !available;
    $('timeline-trial-report').disabled = locked;
    document.querySelector('.timeline-trial-controls').classList.toggle('trial-enabled', enabled());
    $('title-dropzone').classList.toggle('trial-target', enabled());
    $('title-dropzone').querySelector('strong').textContent = enabled() ? '選択中のテロップをここへドラッグ（試験）' : '.mogrtファイルをここにドロップ';
    $('title-dropzone').querySelector('span:last-child').textContent = enabled() ? 'クリックで選択中のクリップを確認' : 'クリックで登録画面を開く';
    document.querySelector('.title-drop-help').textContent = enabled() ? '試験モードは選択クリップを確認してプロジェクト形式で保管します。.mogrtファイルのドロップも使えます。' : 'タイムラインのクリップは、Premiereで.mogrtとして書き出してから登録してください。';
    ['timeline-title-name', 'timeline-title-group', 'timeline-title-track', 'timeline-confirm-source', 'timeline-trial-cancel', 'timeline-trial-delete'].forEach(function (id) { $(id).disabled = locked; });
    $('timeline-trial-save').disabled = locked || !available || !Bridge.hasHost;
    $('timeline-trial-save').textContent = busy ? '処理中…' : editing ? '登録内容を保存' : prepared ? '保管済みの内容で再登録' : '保管して登録（試験）';
  }
  function option(select, value, label) { var el = document.createElement('option'); el.value = value; el.textContent = label; select.appendChild(el); }
  function show(value, existing, groupId, origin) {
    var token = ++dialogGeneration;
    var state = Library.getState(); candidate = value; prepared = existing ? Lib.clone(existing) : null; editing = existing ? existing.id : null; baseline = existing ? JSON.stringify(existing) : null;
    $('timeline-trial-heading').textContent = existing ? '試験テロップの登録設定' : '選択クリップを試験登録';
    $('timeline-trial-notice').textContent = existing ? '保管済みのプロジェクトを使います。名前・グループ・挿入先を変更できます。' : origin === 'drop' ? 'ドラッグした項目自体との一致は未検証です。以下はタイムラインの選択中クリップです。目的のテロップか確認してください。' : '以下はタイムラインの選択中クリップです。保存時に選択が変わっていないことを再確認します。';
    var source = value || existing;
    $('timeline-source-name').textContent = value ? value.clipName : existing.sourceName;
    $('timeline-source-sequence').textContent = value ? value.sequenceName + ' · V' + (value.trackIndex + 1) : '保管済みの試験プロジェクト';
    $('timeline-source-range').textContent = (value ? (Number(value.startTicks) / 254016000000).toFixed(2) + '〜' + (Number(value.endTicks) / 254016000000).toFixed(2) + '秒 · ' : '') + source.width + '×' + source.height + ' · ' + (254016000000 / Number(source.timebase)).toFixed(3) + 'fps';
    $('timeline-title-group').textContent = ''; state.groups.forEach(function (g) { option($('timeline-title-group'), g.id, g.name); }); $('timeline-title-group').value = existing ? existing.groupId : groupId;
    var track = existing ? existing.videoTrack : 'auto'; $('timeline-title-track').textContent = ''; option($('timeline-title-track'), 'auto', '自動・最上段');
    if (track !== 'auto') option($('timeline-title-track'), String(track), 'V' + (track + 1) + '（保存した挿入先）'); $('timeline-title-track').value = String(track);
    var names = state.presets.concat(state.titles || []).filter(function (t) { return t.groupId === groupId; }).map(function (t) { return t.name; });
    $('timeline-title-name').value = existing ? existing.name : Lib.availableName(value.clipName, names);
    $('timeline-confirm-label').hidden = !!existing; $('timeline-confirm-source').required = !existing; $('timeline-confirm-source').checked = false;
    $('timeline-trial-error').textContent = ''; $('timeline-trial-delete').hidden = !existing;
    $('timeline-trial-dialog').showModal(); $('timeline-title-name').focus(); sync();
    if (Bridge.titleContext) Bridge.titleContext().then(function (context) {
      if (token !== dialogGeneration || !$('timeline-trial-dialog').open) return;
      var selected = $('timeline-title-track').value; $('timeline-title-track').textContent = ''; option($('timeline-title-track'), 'auto', '自動・最上段');
      context.videoTracks.forEach(function (track) { option($('timeline-title-track'), String(track.index), 'V' + (track.index + 1) + ' · ' + track.name); });
      if (selected !== 'auto' && !context.videoTracks.some(function (track) { return String(track.index) === selected; })) option($('timeline-title-track'), selected, 'V' + (Number(selected) + 1) + '（保存した挿入先）');
      $('timeline-title-track').value = selected;
    }).catch(function () {});
  }
  async function read(origin) {
    if (busy || otherBusy || Panel.isBusy() || !enabled() || !Bridge.hasHost || !Library.isAvailable() || document.querySelector('dialog[open]')) return;
    var group = Library.getState().activeGroupId; phase(true); log({ phase: 'selection-start', origin: origin });
    try {
      var value = await Bridge.readTimelineCandidate(); Model.validateCandidate(value);
      if (!Library.getState().groups.some(function (g) { return g.id === group; })) throw new Error('対象グループが変更されています。選び直してください。');
      last = { phase: 'selection', ok: true, candidate: Lib.clone(value), origin: origin }; log({ phase: 'selection', ok: true, clipName: value.clipName }); show(value, null, group, origin);
      status('選択クリップの情報を読み込みました。内容を確認して試験登録してください。');
    } catch (error) { last = { phase: 'selection', ok: false, stage: error.stage || null, error: errorText(error) }; log(last); status(last.error, true); }
    finally { phase(false); }
  }
  $('timeline-trial-enabled').addEventListener('change', function () { log({ phase: 'mode', enabled: enabled() }); window.dispatchEvent(new CustomEvent('cardreveal:timeline-trial-mode')); sync(); });
  $('timeline-trial-selection').addEventListener('click', function () { read('selection-button'); });
  var area = $('title-dropzone');
  area.addEventListener('click', function (event) { if (!enabled()) return; event.preventDefault(); event.stopImmediatePropagation(); read('zone-click'); }, true);
  ['dragenter', 'dragover', 'drop'].forEach(function (type) { area.addEventListener(type, function (event) {
    if (!enabled()) return;
    var transfer = event.dataTransfer, formats = transfer ? Array.from(transfer.types || []).slice(0, 16).map(function (s) { return String(s).slice(0, 120); }) : [];
    // Metadata only: do not store clipboard text, file paths, or native payload
    // bodies. Reports stay local until the user chooses to share them.
    if (type !== 'dragover' || !records.length || records[records.length - 1].phase !== 'dragover') log({ phase: type, trusted: event.isTrusted, types: formats, fileCount: transfer && transfer.files ? transfer.files.length : 0 });
    if (type === 'drop' && !(transfer && transfer.files && transfer.files.length)) { event.preventDefault(); event.stopImmediatePropagation(); area.classList.remove('drop-active'); read('drop'); }
  }, true); });
  $('timeline-trial-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (busy || otherBusy || Panel.isBusy() || !Bridge.hasHost) return;
    var selectedTrack = $('timeline-title-track').value, track = selectedTrack === 'auto' ? 'auto' : Number(selectedTrack);
    var record = { id: editing, name: $('timeline-title-name').value, groupId: $('timeline-title-group').value, videoTrack: track, sourceType: 'timeline' };
    $('timeline-trial-error').textContent = '';
    try {
      if (!prepared && (!candidate || !$('timeline-confirm-source').checked)) throw new Error('表示した選択クリップを確認し、チェックを入れてください。');
      var format = prepared || candidate;
      // Validate name/group/track before creating any temporary sequence/file.
      Lib.saveTitle(Library.getState(), Object.assign({}, record, format, { id: editing, name: record.name, groupId: record.groupId, videoTrack: track, sourceType: 'timeline', templatePath: prepared ? prepared.templatePath : '/pending/timeline.prproj', sequenceId: prepared ? prepared.sequenceId : 'pending', durationTicks: prepared ? prepared.durationTicks : '1' }));
      phase(true);
      if (!prepared) { prepared = await Bridge.preserveTimelineTitle(Lib.clone(candidate)); Model.validateTemplate(prepared); log({ phase: 'capture', ok: true, warnings: prepared.warnings || [] }); }
      ['templatePath', 'sourceName', 'sequenceId', 'width', 'height', 'timebase', 'durationTicks'].forEach(function (key) { record[key] = prepared[key]; });
      var saved = Library.commit(function (next) {
        if (editing && JSON.stringify((next.titles || []).find(function (t) { return t.id === editing; })) !== baseline) throw new Error('登録が別の画面で更新されています。一度閉じて開き直してください。');
        return Lib.saveTitle(next, record);
      });
      last = { phase: 'registered', ok: true, clipName: saved.sourceName, warnings: prepared.warnings || [] };
      $('title-search').value = ''; $('title-search').dispatchEvent(new Event('input'));
      var warning = (prepared.warnings || []).join(' '); $('timeline-trial-dialog').close(); status('「' + saved.name + '」を試験テロップとして保管しました。空のテストシーケンスで挿入をお試しください。' + warning, !!warning);
    } catch (error) { last = { phase: prepared ? 'registration' : 'capture', ok: false, stage: error.stage || null, error: errorText(error) }; log(last); $('timeline-trial-error').textContent = last.error; }
    finally { if (busy) phase(false); else sync(); }
  });
  $('timeline-trial-cancel').addEventListener('click', function () { if (!busy) $('timeline-trial-dialog').close(); });
  $('timeline-trial-dialog').addEventListener('cancel', function (event) { if (busy) event.preventDefault(); });
  $('timeline-trial-dialog').addEventListener('close', function () { dialogGeneration++; candidate = null; prepared = null; editing = null; baseline = null; });
  document.addEventListener('keydown', function (event) { if ($('timeline-trial-dialog').open && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); if (!busy && !otherBusy) $('timeline-trial-form').requestSubmit(); } });
  $('title-gallery').addEventListener('click', function (event) {
    var button = event.target.closest('[data-manage-title]'); if (!button || busy || otherBusy || Panel.isBusy()) return;
    var record = (Library.getState().titles || []).find(function (t) { return t.id === button.dataset.manageTitle; });
    if (!record || record.sourceType !== 'timeline') return; event.preventDefault(); event.stopImmediatePropagation(); show(null, record, record.groupId, 'manage');
  }, true);
  $('timeline-trial-delete').addEventListener('click', function () {
    if (!editing || busy || !window.confirm('この試験テロップの登録を削除しますか？ 保管ファイルと挿入済みのシーケンスは残ります。')) return;
    try { Library.commit(function (next) { Lib.removeTitle(next, editing); }); $('timeline-trial-dialog').close(); status('試験テロップの登録を削除しました。'); } catch (error) { $('timeline-trial-error').textContent = errorText(error); }
  });
  $('timeline-trial-report').addEventListener('click', async function () {
    if (busy || otherBusy || Panel.isBusy()) return;
    var report = { format: 'card-reveal-timeline-trial-v1', createdAt: new Date().toISOString(), enabled: enabled(), hostAvailable: !!Bridge.hasHost, nativeDropIdentityVerified: false, last: last, events: records.slice() };
    try {
      if (Bridge.hasHost && Bridge.saveTimelineTrialReport) { if (await Bridge.saveTimelineTrialReport(report) === null) return; }
      else { var url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'timeline-drag-diagnostic.json'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }
      status('診断JSONを端末に保存しました。自動送信はしていません。');
    } catch (error) { status(errorText(error), true); }
  });
  window.addEventListener('cardreveal:title-busy', function (event) { if (event.detail.owner !== 'timeline-trial') otherBusy = !!event.detail.busy; sync(); });
  window.addEventListener('cardreveal:timeline-trial-insert', function (event) { last = Object.assign({ phase: 'insert' }, event.detail); log(last); });
  window.addEventListener('cardreveal:busy', sync); window.addEventListener('cardreveal:library-changed', sync);
  window.CardTimelineTrialPanel = { isEnabled: enabled }; sync(); window.dispatchEvent(new CustomEvent('cardreveal:timeline-trial-mode'));
}());
