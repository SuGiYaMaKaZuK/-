(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Library = window.CardLibraryPanel, Panel = window.CardPanel, Folders = window.CardMediaGroups, Media = window.CardMediaLibrary;
  var view = 'effects', pluginView = 'effects', previewItem = null, addingKind = null, moving = null;
  var navigation = { node: $('channel-sidebar'), slot: $('channel-sidebar-slot'), dialog: $('channels-drawer'), toggle: $('toggle-channel-sidebar') };
  var narrow = window.matchMedia('(max-width: 760px)');
  function busy() { return Panel.isBusy(); }
  function isMedia() { return view === 'images' || view === 'videos'; }
  function mediaKind() { return view === 'videos' ? 'video' : 'image'; }
  function mediaLabel(kind) { return kind === 'video' ? '動画' : '画像'; }
  function message(error) { return error.name === 'QuotaExceededError' || error.code === 22 ? '保存容量がいっぱいです。既存の保存データは保持しています。不要なデータを整理して再度お試しください。' : error.message || String(error); }
  function restore() { if (navigation.node.parentNode !== navigation.slot) navigation.slot.appendChild(navigation.node); navigation.toggle.setAttribute('aria-expanded', 'false'); }
  function closeNavigation() { if (navigation.dialog.open) navigation.dialog.close(); restore(); }
  function layoutChannels() {
    var nav = $('plugin-channels'), slot = $('compact-channel-slot');
    if (narrow.matches) slot.appendChild(nav);
    else { closeNavigation(); $('plugin-sidebar').prepend(nav); }
    slot.hidden = !narrow.matches || isMedia();
  }
  function openNavigation() { if (busy() || !narrow.matches || document.querySelector('dialog[open]')) return; navigation.dialog.appendChild(navigation.node); navigation.dialog.showModal(); navigation.toggle.setAttribute('aria-expanded', 'true'); var selected = $(isMedia() ? 'media-sidebar' : 'plugin-sidebar').querySelector('[aria-selected=true]') || $('close-channel-sidebar'); if (selected) selected.focus(); }
  function setView(next, focus) {
    if (next === 'all' || next === 'plugins') next = 'effects';
    if (busy() || ['effects', 'templates', 'videos', 'images'].indexOf(next) < 0) return;
    if ((next === 'videos' || next === 'images') && next !== view) $('media-collection-search').value = '';
    if (isMedia() && next !== 'images' && next !== 'videos') $('media-collection-grid').replaceChildren();
    view = next; if (!isMedia()) pluginView = next; document.querySelector('.studio-layout').dataset.view = next;
    document.querySelector('.saved-library').hidden = next !== 'effects'; $('template-panel-slot').hidden = next !== 'templates'; $('media-collection').hidden = !isMedia();
    $('plugin-sidebar').hidden = isMedia(); $('media-sidebar').hidden = !isMedia();
    document.querySelectorAll('[data-library-view]').forEach(function (button) { if (button.dataset.libraryView === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $('workspace-title').textContent = next === 'templates' ? '元素材' : next === 'effects' ? '作成済みの素材' : next === 'videos' ? '動画' : '画像';
    $('media-import-status').hidden = true; closeNavigation(); sync();
    if (focus) (next === 'templates' ? $('template-cards') : isMedia() ? $('media-collection-search') : $('main-search')).focus({ preventScroll: true });
  }
  function assignmentMap(section) { var map = Object.create(null); section.assignments.forEach(function (item) { map[item.mediaPath] = item.groupId; }); return map; }
  function groupId(section, map, path) { return map[path] || section.groups[0].id; }
  function icon(name) { var el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.classList.add('ui-icon'); el.setAttribute('aria-hidden', 'true'); var use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + name); el.appendChild(use); return el; }
  // Rebuild the index after a successful library change. Searches use the active group's list.
  var mediaView, groupedMedia, mediaCounts;
  function refreshLibrary() {
    mediaView = Library.getMediaView();
    groupedMedia = { image: new Map(), video: new Map() };
    mediaCounts = { image: 0, video: 0 };
    var assignments = {
      image: assignmentMap(mediaView.mediaGroups.image),
      video: assignmentMap(mediaView.mediaGroups.video)
    };
    mediaView.media.forEach(function (item) {
      var kind = item.mediaType, groups = groupedMedia[kind];
      var id = groupId(mediaView.mediaGroups[kind], assignments[kind], item.mediaPath);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(item);
      mediaCounts[kind]++;
    });
    sync();
  }
  function sync() {
    var group = mediaView.group;
    $('sidebar-group-name').textContent = isMedia() ? mediaLabel(mediaKind()) : 'プラグイン'; $('sidebar-group-name').title = $('sidebar-group-name').textContent;
    $('channel-effect-count').textContent = mediaView.effectCount;
    var section = isMedia() ? mediaView.mediaGroups[mediaKind()] : null;
    var visibleGroup = section ? section.groups.find(function (item) { return item.id === section.activeGroupId; }) : group;
    $('compact-group-name').textContent = visibleGroup.name;
    navigation.toggle.setAttribute('aria-label', (isMedia() ? mediaLabel(mediaKind()) : '保存') + 'のグループを選ぶ（' + visibleGroup.name + '）');
    $('group-heading').hidden = isMedia(); $('media-collection-title').hidden = !isMedia();
    $('compact-channel-slot').hidden = !narrow.matches || isMedia();
    document.querySelectorAll('[data-library-view],#empty-open-templates,#toggle-channel-sidebar,#library-home-button,#open-video-library,#open-image-library,#media-collection-manage,#media-preview-manage,#add-media-group').forEach(function (button) { button.disabled = busy(); });
    $('rail-video-count').textContent = mediaCounts.video; $('rail-image-count').textContent = mediaCounts.image;
    var current = view === 'videos' ? 'open-video-library' : view === 'images' ? 'open-image-library' : 'library-home-button';
    document.querySelectorAll('.rail-category').forEach(function (button) { if (button.id === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    if (isMedia()) { renderGroups(); renderMedia(); }
  }
  function renderGroups() {
    var kind = mediaKind(), section = mediaView.mediaGroups[kind], target = $('media-group-tabs');
    $('media-group-section-title').textContent = mediaLabel(kind) + 'のグループ'; $('add-media-group').setAttribute('aria-label', mediaLabel(kind) + 'のグループを追加'); target.setAttribute('aria-label', mediaLabel(kind) + 'のグループ'); target.textContent = '';
    section.groups.forEach(function (group) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'channel-button media-group-tab'; button.dataset.mediaGroup = group.id; button.title = group.name + ' · 右クリックで管理'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('role', 'tab'); button.setAttribute('aria-label', group.name); button.setAttribute('aria-controls', 'media-collection-grid'); button.setAttribute('aria-selected', String(group.id === section.activeGroupId)); button.tabIndex = group.id === section.activeGroupId ? 0 : -1; button.disabled = busy(); button.appendChild(icon('hash'));
      var name = document.createElement('span'); name.textContent = group.name; button.appendChild(name); var count = document.createElement('span'); count.className = 'channel-count'; count.textContent = (groupedMedia[kind].get(group.id) || []).length; button.appendChild(count); target.appendChild(button);
    });

  }
  function selectMediaGroup(id, focus) {
    if (busy() || !isMedia()) return; $('media-import-status').hidden = true; var kind = mediaKind();
    try { Library.commit(function (state) { Folders.select(state, kind, id); }); if (focus) { var button = Array.from($('media-group-tabs').children).find(function (node) { return node.dataset.mediaGroup === id; }); if (button) button.focus(); } else { closeNavigation(); $('media-collection-search').focus({ preventScroll: true }); } } catch (error) { status(error.message, true); }
  }
  function status(text, error) { $('status-text').textContent = text; $('status').classList.toggle('error', !!error); }
  function mediaURL(value) { if (/^(?:https?:|file:|blob:|data:(?:image|video)\/)/i.test(value)) return value; if (window.CardBridge.mediaURL) return window.CardBridge.mediaURL(value); if (/^[A-Za-z]:[\\/]|^\\\\/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null; return new URL(value, window.location.href).href; }
  function renderMedia() {
    var kind = mediaKind(), section = mediaView.mediaGroups[kind], current = section.groups.find(function (group) { return group.id === section.activeGroupId; }), query = $('media-collection-search').value.trim().toLocaleLowerCase();
    var total = (groupedMedia[kind].get(current.id) || []), items = query ? total.filter(function (item) { return (item.name + ' ' + item.filename + ' ' + item.usedBy.join(' ')).toLocaleLowerCase().indexOf(query) >= 0; }) : total;
    $('media-collection-title').textContent = '# ' + current.name; $('media-collection-count').textContent = query ? items.length + ' / ' + total.length : total.length;
    $('media-empty-heading').textContent = query ? '一致する素材はありません' : 'このグループにはまだ' + mediaLabel(kind) + 'がありません'; $('media-collection-empty').hidden = !!items.length;
    $('media-collection-empty').querySelector('p').textContent = query ? '別の素材名や使用先で検索してください。' : 'エクスプローラーからドロップすると、ここに登録されます。';
    var grid = $('media-collection-grid'); grid.textContent = '';
    items.forEach(function (item) {
      var article = document.createElement('article'); article.className = 'preset-tile media-tile'; var button = document.createElement('button'); button.type = 'button'; button.className = 'preset-open'; button.disabled = busy(); button.setAttribute('aria-label', item.name + 'をプレビュー');
      var art = document.createElement('span'); art.className = 'preset-art media-art'; art.appendChild(icon(kind === 'video' ? 'film' : 'image'));
      if (kind === 'image') { var src = mediaURL(item.mediaPath); if (src) { var image = document.createElement('img'); image.alt = ''; image.loading = 'lazy'; image.src = src; image.onerror = function () { image.hidden = true; }; art.appendChild(image); } }
      var badge = document.createElement('span'); badge.className = 'preset-mode-badge'; badge.textContent = mediaLabel(kind); art.appendChild(badge); button.appendChild(art);
      var name = document.createElement('span'); name.className = 'preset-title'; name.textContent = item.name; name.title = item.filename; button.appendChild(name); var uses = document.createElement('span'); uses.className = 'preset-subtitle'; uses.textContent = item.usedBy.length ? item.usedBy.length + '件の演出で使用' : '素材と配置に登録済み'; button.appendChild(uses);
      button.addEventListener('click', function () { if (!busy()) showMedia(item); }); article.appendChild(button);
      var menu = document.createElement('button'); menu.type = 'button'; menu.className = 'preset-menu'; menu.dataset.moveMedia = 'true'; menu.disabled = busy(); menu.setAttribute('aria-label', item.name + 'のグループを変更'); menu.title = 'グループを変更'; menu.textContent = '⋯'; menu.addEventListener('click', function () { openMove(item); }); article.appendChild(menu); grid.appendChild(article);
    });
  }
  $('add-media-group').addEventListener('click', function () {
    if (!isMedia() || busy() || !Library.isAvailable()) return;
    addingKind = mediaKind(); closeNavigation();
    $('media-group-dialog-title').textContent = mediaLabel(addingKind) + 'のグループを追加';
    $('media-group-name').value = ''; $('media-group-error').textContent = '';
    $('media-group-dialog').showModal(); $('media-group-name').focus();
  });
  $('media-group-form').addEventListener('submit', function (event) {
    event.preventDefault(); if (!addingKind || busy()) return;
    try {
      Library.commit(function (state) { Folders.add(state, addingKind, $('media-group-name').value); });
      $('media-group-dialog').close(); status('素材グループを追加しました。');
    } catch (error) { $('media-group-error').textContent = message(error); }
  });
  $('media-group-tabs').addEventListener('click', function (event) { var button = event.target.closest('[data-media-group]'); if (button) selectMediaGroup(button.dataset.mediaGroup, false); });
  $('media-group-tabs').addEventListener('keydown', function (event) { var keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']; if (keys.indexOf(event.key) < 0 || !isMedia() || busy()) return; var section = mediaView.mediaGroups[mediaKind()], index = section.groups.findIndex(function (group) { return group.id === section.activeGroupId; }); if (event.key === 'Home') index = 0; else if (event.key === 'End') index = section.groups.length - 1; else index = (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : section.groups.length - 1)) % section.groups.length; event.preventDefault(); selectMediaGroup(section.groups[index].id, true); });
  function openMove(item) {
    if (busy() || document.querySelector('dialog[open]')) return; var section = mediaView.mediaGroups[item.mediaType]; moving = { item: item, groupId: section.activeGroupId }; $('media-move-name').textContent = item.name; $('media-move-target').textContent = ''; section.groups.forEach(function (group) { var option = document.createElement('option'); option.value = group.id; option.textContent = '# ' + group.name; $('media-move-target').appendChild(option); }); $('media-move-target').value = moving.groupId; $('media-move-error').textContent = ''; $('media-move-dialog').showModal(); $('media-move-target').focus();
  }
  $('media-move-form').addEventListener('submit', function (event) { event.preventDefault(); if (!moving || busy()) return; try { var target = $('media-move-target').value; if (target !== moving.groupId) Library.commit(function (state) { if (Folders.groupFor(state, moving.item.mediaType, moving.item.mediaPath) !== moving.groupId) throw new Error('素材のグループが別の画面で変更されています。開き直してください。'); Folders.assign(state, moving.item.mediaType, [moving.item.mediaPath], target); }); $('media-move-dialog').close(); status('素材のグループを変更しました。'); } catch (error) { $('media-move-error').textContent = message(error); } });
  function releasePreview() { var video = $('media-preview-video'); video.pause(); video.onerror = null; video.removeAttribute('src'); video.load(); $('media-preview-image').onerror = null; $('media-preview-image').removeAttribute('src'); }
  function showMedia(item) {
    if (document.querySelector('dialog[open]')) return; releasePreview(); previewItem = item;
    var image = $('media-preview-image'), video = $('media-preview-video'), error = $('media-preview-error'), src = mediaURL(item.mediaPath); $('media-preview-title').textContent = item.name; $('media-preview-kind').textContent = mediaLabel(item.mediaType); $('media-preview-path').value = item.mediaPath; $('media-preview-uses').textContent = item.usedBy.length ? '使用している演出：' + item.usedBy.join('、') : '素材と配置に登録されています。'; error.hidden = true; image.hidden = item.mediaType !== 'image'; video.hidden = item.mediaType !== 'video';
    function failed() { error.textContent = '素材を表示できません。元ファイルの場所を確認してください。'; error.hidden = false; }
    if (!src) failed(); else if (item.mediaType === 'image') { image.onerror = failed; image.src = src; } else { video.onerror = failed; video.muted = true; video.src = src; } $('media-preview-dialog').showModal();
  }
  $('media-preview-dialog').addEventListener('close', function () { if (!$('media-preview-dialog').open) { releasePreview(); previewItem = null; } });
  $('media-preview-manage').addEventListener('click', function () { if (busy()) return; var item = previewItem; $('media-preview-dialog').close(); $('open-assets-library').click(); if (item && item.assetIds.length) { if ($('sabu-content').hidden) $('sabu-tab').click(); if ($('sabu-search').value) { $('sabu-search').value = ''; $('sabu-search').dispatchEvent(new Event('input')); } var button = Array.from(document.querySelectorAll('[data-sabu-edit]')).find(function (node) { return item.assetIds.indexOf(node.dataset.sabuEdit) >= 0; }); if (button) button.click(); } });
  $('media-collection-search').addEventListener('input', renderMedia); $('media-collection-search').addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); this.value = ''; renderMedia(); } });
  document.querySelectorAll('[data-library-view]').forEach(function (button) { button.addEventListener('click', function () { setView(button.dataset.libraryView, true); }); });
  $('library-home-button').addEventListener('click', function () { setView(pluginView, false); }); $('open-video-library').addEventListener('click', function () { setView('videos', false); }); $('open-image-library').addEventListener('click', function () { setView('images', false); }); $('empty-open-templates').addEventListener('click', function () { setView('templates', true); });
  $('toggle-channel-sidebar').addEventListener('click', openNavigation); $('close-channel-sidebar').addEventListener('click', closeNavigation); navigation.dialog.addEventListener('close', function () { if (!navigation.dialog.open) restore(); }); navigation.dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeNavigation(); }); navigation.dialog.addEventListener('click', function (event) { if (event.target !== navigation.dialog) return; var bounds = navigation.dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeNavigation(); });
  document.addEventListener('click', function (event) { var button = event.target.closest('button'); if (!button || button.disabled) return; if (navigation.dialog.open && button.id === 'add-group') closeNavigation(); if (view === 'templates' && button.dataset.templateMode) setView('effects', false); }, true);
  narrow.addEventListener('change', layoutChannels); $('group-tabs').addEventListener('click', function () { if (view === 'templates') setView('effects', false); else closeNavigation(); }); $('group-tabs').addEventListener('keydown', function (event) { if (view === 'templates' && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) setView('effects', false); });
  document.addEventListener('keydown', function (event) { if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f' || document.querySelector('dialog[open]')) return; event.preventDefault(); event.stopImmediatePropagation(); if (view === 'templates') setView('effects', false); var search = isMedia() ? $('media-collection-search') : $('main-search'); search.focus(); search.select(); }, true);
  function registerDrop(surface, feedback, available) {
    function report(text, failed) {
      feedback.textContent = text; feedback.hidden = false;
      feedback.classList.toggle('error', !!failed); status(text, failed);
    }
    window.CardMediaDrop.bind(surface, {
      multiple: true, persistent: true,
      available: function () { return !busy() && Library.isAvailable() && available(); },
      target: function () { return surface; },
      receive: function (files) {
        var visible = mediaView.mediaGroups;
        var destinations = { image: visible.image.activeGroupId, video: visible.video.activeGroupId };
        var result = Library.commit(function (state) { return Media.register(state, files, destinations); });
        var search = surface === $('media-collection') ? $('media-collection-search') : $('sabu-search');
        if (search.value) { search.value = ''; search.dispatchEvent(new Event('input')); }
        if (surface === $('assets-library-dialog') && $('sabu-content').hidden) $('sabu-tab').click();
        report(result.map(function (part) { return mediaLabel(part.type) + part.count + '件を「# ' + part.groupName + '」に登録しました。'; }).join(' '));
      },
      error: function (error) { report(message(error), true); }
    });
  }
  registerDrop($('media-collection'), $('media-import-status'), function () { return isMedia() && !document.querySelector('dialog[open]'); });
  registerDrop($('assets-library-dialog'), $('assets-import-status'), function () {
    return $('assets-library-dialog').open && !$('sabu-dialog').open;
  });
  ['dragover', 'drop'].forEach(function (name) { window.addEventListener(name, function (event) { event.preventDefault(); }); });
  window.addEventListener('cardreveal:library-changed', refreshLibrary); window.addEventListener('cardreveal:busy', sync);
  window.CardDiscordUI = { getView: function () { return view; }, showView: function (next) { setView(next, false); }, openNavigation: openNavigation, openTemplates: function () { setView('templates', false); } };
  layoutChannels(); refreshLibrary();
}());
