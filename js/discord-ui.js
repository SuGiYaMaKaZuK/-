(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Library = window.CardLibraryPanel, Panel = window.CardPanel, Folders = window.CardMediaGroups, Media = window.CardMediaLibrary;
  var view = 'effects', pluginView = 'effects', previewItem = null, groupEdit = null, moving = null;
  var navigation = { node: $('channel-sidebar'), slot: $('channel-sidebar-slot'), dialog: $('channels-drawer'), toggle: $('toggle-channel-sidebar') };
  var narrow = window.matchMedia('(max-width: 760px)');
  function busy() { return Panel.isBusy(); }
  function isMedia() { return view === 'images' || view === 'videos'; }
  function mediaKind() { return view === 'videos' ? 'video' : 'image'; }
  function mediaLabel(kind) { return kind === 'video' ? '動画' : '画像'; }
  function message(error) { return error.name === 'QuotaExceededError' || error.code === 22 ? '保存容量がいっぱいです。既存の保存データは保持しています。不要なデータを整理して再度お試しください。' : error.message || String(error); }
  function restore() { if (navigation.node.parentNode !== navigation.slot) navigation.slot.appendChild(navigation.node); navigation.toggle.setAttribute('aria-expanded', 'false'); }
  function closeNavigation() { if (navigation.dialog.open) navigation.dialog.close(); restore(); }
  function openNavigation() { if (busy() || !narrow.matches || document.querySelector('dialog[open]')) return; navigation.dialog.appendChild(navigation.node); navigation.dialog.showModal(); navigation.toggle.setAttribute('aria-expanded', 'true'); var selected = navigation.node.querySelector('[aria-current=page]') || navigation.node.querySelector('[aria-selected=true]') || navigation.node.querySelector('button:not(:disabled)'); if (selected) selected.focus(); }
  function setView(next, focus) {
    if (next === 'all' || next === 'plugins') next = 'effects';
    if (busy() || ['effects', 'templates', 'videos', 'images'].indexOf(next) < 0) return;
    if ((next === 'videos' || next === 'images') && next !== view) $('media-collection-search').value = '';
    view = next; if (!isMedia()) pluginView = next; document.querySelector('.studio-layout').dataset.view = next;
    document.querySelector('.saved-library').hidden = next !== 'effects'; $('template-panel-slot').hidden = next !== 'templates'; $('media-collection').hidden = !isMedia();
    $('plugin-sidebar').hidden = isMedia(); $('media-sidebar').hidden = !isMedia();
    document.querySelectorAll('[data-library-view]').forEach(function (button) { if (button.dataset.libraryView === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $('workspace-title').textContent = next === 'templates' ? '元素材' : next === 'effects' ? '作成済みの素材' : next === 'videos' ? '作成に使用した動画' : '作成に使用した画像';
    closeNavigation(); sync();
    if (focus) (next === 'templates' ? $('template-cards') : isMedia() ? $('media-collection-search') : $('main-search')).focus({ preventScroll: true });
  }
  function assignmentMap(section) { var map = Object.create(null); section.assignments.forEach(function (item) { map[item.mediaPath] = item.groupId; }); return map; }
  function groupId(section, map, path) { return map[path] || section.groups[0].id; }
  function icon(name) { var el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.classList.add('ui-icon'); el.setAttribute('aria-hidden', 'true'); var use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + name); el.appendChild(use); return el; }
  function sync() {
    var state = Library.getState(), group = state.groups.find(function (item) { return item.id === state.activeGroupId; }) || state.groups[0], media = Media.collect(state);
    $('sidebar-group-name').textContent = isMedia() ? mediaLabel(mediaKind()) : 'プラグイン'; $('sidebar-group-name').title = $('sidebar-group-name').textContent;
    $('channel-effect-count').textContent = state.presets.filter(function (item) { return item.groupId === group.id; }).length;
    $('workspace-group-name').textContent = isMedia() ? '# ' + Folders.section(state, mediaKind()).groups.find(function (item) { return item.id === Folders.section(state, mediaKind()).activeGroupId; }).name : group.name + (view === 'templates' ? ' に保存できます' : ' の保存済み素材');
    document.querySelectorAll('[data-library-view],[data-template-shortcut],#toggle-channel-sidebar,#library-home-button,#open-video-library,#open-image-library,#media-collection-manage,#media-preview-manage,#add-media-group,#rename-media-group').forEach(function (button) { button.disabled = busy(); });
    $('rail-video-count').textContent = media.filter(function (item) { return item.mediaType === 'video'; }).length; $('rail-image-count').textContent = media.filter(function (item) { return item.mediaType === 'image'; }).length;
    var current = view === 'videos' ? 'open-video-library' : view === 'images' ? 'open-image-library' : 'library-home-button';
    document.querySelectorAll('.rail-category').forEach(function (button) { if (button.id === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    if (isMedia()) { renderGroups(state, media); renderMedia(media, state); }
  }
  function renderGroups(state, media) {
    var kind = mediaKind(), section = Folders.section(state, kind), map = assignmentMap(section), counts = Object.create(null), target = $('media-group-tabs');
    media.filter(function (item) { return item.mediaType === kind; }).forEach(function (item) { var id = groupId(section, map, item.mediaPath); counts[id] = (counts[id] || 0) + 1; });
    $('media-group-section-title').textContent = mediaLabel(kind) + 'のグループ'; $('add-media-group').setAttribute('aria-label', mediaLabel(kind) + 'のグループを追加'); target.setAttribute('aria-label', mediaLabel(kind) + 'のグループ'); target.textContent = '';
    section.groups.forEach(function (group) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'channel-button media-group-tab'; button.dataset.mediaGroup = group.id; button.setAttribute('role', 'tab'); button.setAttribute('aria-label', group.name); button.setAttribute('aria-controls', 'media-collection-grid'); button.setAttribute('aria-selected', String(group.id === section.activeGroupId)); button.tabIndex = group.id === section.activeGroupId ? 0 : -1; button.disabled = busy(); button.appendChild(icon('hash'));
      var name = document.createElement('span'); name.textContent = group.name; button.appendChild(name); var count = document.createElement('span'); count.className = 'channel-count'; count.textContent = counts[group.id] || 0; button.appendChild(count); target.appendChild(button);
    });
    $('delete-media-group').disabled = busy() || section.groups.length < 2;
  }
  function selectMediaGroup(id, focus) {
    if (busy() || !isMedia()) return; var kind = mediaKind();
    try { Library.commit(function (state) { Folders.select(state, kind, id); }); if (focus) { var button = Array.from($('media-group-tabs').children).find(function (node) { return node.dataset.mediaGroup === id; }); if (button) button.focus(); } else { closeNavigation(); $('media-collection-search').focus({ preventScroll: true }); } } catch (error) { status(error.message, true); }
  }
  function status(text, error) { $('status-text').textContent = text; $('status').classList.toggle('error', !!error); }
  function mediaURL(value) { if (/^(?:https?:|file:|blob:|data:(?:image|video)\/)/i.test(value)) return value; if (window.CardBridge.mediaURL) return window.CardBridge.mediaURL(value); if (/^[A-Za-z]:[\\/]|^\\\\/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null; return new URL(value, window.location.href).href; }
  function renderMedia(all, state) {
    var kind = mediaKind(), section = Folders.section(state, kind), map = assignmentMap(section), current = section.groups.find(function (group) { return group.id === section.activeGroupId; }), query = $('media-collection-search').value.trim().toLocaleLowerCase();
    var total = all.filter(function (item) { return item.mediaType === kind && groupId(section, map, item.mediaPath) === current.id; }), items = total.filter(function (item) { return !query || (item.name + ' ' + item.filename + ' ' + item.usedBy.join(' ')).toLocaleLowerCase().indexOf(query) >= 0; });
    $('media-collection-title').textContent = '# ' + current.name; $('media-collection-help').textContent = mediaLabel(kind) + 'のグループです。素材の「⋯」から移動先を選べます。'; $('media-collection-count').textContent = query ? items.length + ' / ' + total.length : total.length;
    $('media-empty-heading').textContent = query ? '一致する素材はありません' : 'このグループにはまだ' + mediaLabel(kind) + 'がありません'; $('media-collection-empty').hidden = !!items.length;
    $('media-collection-empty').querySelector('p').textContent = query ? '別の素材名や使用先で検索してください。' : current.id === section.groups[0].id ? '素材と配置に登録するか、素材を使った演出を保存すると表示されます。' : 'ほかのグループにある素材の「⋯」から、このグループへ移動できます。';
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
  function openGroupEditor(action) {
    if (!isMedia() || busy() || !Library.isAvailable()) return; var kind = mediaKind(), section = Folders.section(Library.getState(), kind), selected = section.groups.find(function (group) { return group.id === section.activeGroupId; }); closeNavigation();
    groupEdit = { kind: kind, action: action, id: selected.id, name: selected.name }; $('media-group-dialog-title').textContent = mediaLabel(kind) + 'のグループを' + (action === 'add' ? '追加' : '変更'); $('confirm-media-group').textContent = action === 'add' ? '作成' : '変更を保存'; $('media-group-name').value = action === 'add' ? '' : selected.name; $('media-group-error').textContent = ''; $('media-group-dialog').showModal(); $('media-group-name').focus();
  }
  $('media-group-form').addEventListener('submit', function (event) {
    event.preventDefault(); if (!groupEdit || busy()) return;
    try { Library.commit(function (state) { if (groupEdit.action === 'add') Folders.add(state, groupEdit.kind, $('media-group-name').value); else { var original = Folders.section(state, groupEdit.kind).groups.find(function (group) { return group.id === groupEdit.id; }); if (!original || original.name !== groupEdit.name) throw new Error('グループが別の画面で更新されています。開き直してください。'); Folders.rename(state, groupEdit.kind, groupEdit.id, $('media-group-name').value); } }); $('media-group-dialog').close(); status('素材グループを保存しました。'); } catch (error) { $('media-group-error').textContent = message(error); }
  });
  $('add-media-group').addEventListener('click', function () { openGroupEditor('add'); }); $('rename-media-group').addEventListener('click', function () { openGroupEditor('rename'); });
  $('delete-media-group').addEventListener('click', function () {
    if (!isMedia() || busy()) return; var kind = mediaKind(), section = Folders.section(Library.getState(), kind), current = section.groups.find(function (group) { return group.id === section.activeGroupId; }), target = section.groups.find(function (group) { return group.id !== current.id; }); if (!target) return;
    if (!window.confirm('「' + current.name + '」を削除し、素材を「' + target.name + '」へ移します。素材ファイルは削除しません。')) return;
    try { Library.commit(function (state) { Folders.remove(state, kind, current.id, target.id); }); status('グループを削除し、素材を移しました。'); } catch (error) { status(error.message, true); }
  });
  $('media-group-tabs').addEventListener('click', function (event) { var button = event.target.closest('[data-media-group]'); if (button) selectMediaGroup(button.dataset.mediaGroup, false); });
  $('media-group-tabs').addEventListener('keydown', function (event) { var keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']; if (keys.indexOf(event.key) < 0 || !isMedia() || busy()) return; var section = Folders.section(Library.getState(), mediaKind()), index = section.groups.findIndex(function (group) { return group.id === section.activeGroupId; }); if (event.key === 'Home') index = 0; else if (event.key === 'End') index = section.groups.length - 1; else index = (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : section.groups.length - 1)) % section.groups.length; event.preventDefault(); selectMediaGroup(section.groups[index].id, true); });
  function openMove(item) {
    if (busy() || document.querySelector('dialog[open]')) return; var section = Folders.section(Library.getState(), item.mediaType); moving = { item: item, groupId: Folders.groupFor(Library.getState(), item.mediaType, item.mediaPath) }; $('media-move-name').textContent = item.name; $('media-move-target').textContent = ''; section.groups.forEach(function (group) { var option = document.createElement('option'); option.value = group.id; option.textContent = '# ' + group.name; $('media-move-target').appendChild(option); }); $('media-move-target').value = moving.groupId; $('media-move-error').textContent = ''; $('media-move-dialog').showModal(); $('media-move-target').focus();
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
  $('media-preview-manage').addEventListener('click', function () { if (busy()) return; var item = previewItem; $('media-preview-dialog').close(); $('open-assets-library').click(); if (item && item.assetIds.length) { $('sabu-search').value = ''; $('sabu-search').dispatchEvent(new Event('input')); var button = Array.from(document.querySelectorAll('[data-sabu-edit]')).find(function (node) { return item.assetIds.indexOf(node.dataset.sabuEdit) >= 0; }); if (button) button.click(); } });
  $('media-collection-search').addEventListener('input', function () { renderMedia(Media.collect(Library.getState()), Library.getState()); }); $('media-collection-search').addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); this.value = ''; renderMedia(Media.collect(Library.getState()), Library.getState()); } });
  $('media-collection-manage').addEventListener('click', function () { if (!busy()) $('open-assets-library').click(); });
  document.querySelectorAll('[data-library-view]').forEach(function (button) { button.addEventListener('click', function () { setView(button.dataset.libraryView, true); }); });
  $('library-home-button').addEventListener('click', function () { setView(pluginView, false); }); $('open-video-library').addEventListener('click', function () { setView('videos', false); }); $('open-image-library').addEventListener('click', function () { setView('images', false); }); $('close-template-panel').addEventListener('click', function () { setView('effects', true); });
  $('toggle-channel-sidebar').addEventListener('click', openNavigation); $('close-channel-sidebar').addEventListener('click', closeNavigation); navigation.dialog.addEventListener('close', function () { if (!navigation.dialog.open) restore(); }); navigation.dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeNavigation(); }); navigation.dialog.addEventListener('click', function (event) { if (event.target !== navigation.dialog) return; var bounds = navigation.dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeNavigation(); });
  document.addEventListener('click', function (event) { var button = event.target.closest('button'); if (!button || button.disabled) return; if (navigation.dialog.open && (['open-assets-library', 'add-group', 'rename-group', 'delete-group'].indexOf(button.id) >= 0 || button.dataset.templateShortcut)) closeNavigation(); if (view === 'templates' && button.dataset.templateMode) setView('effects', false); }, true);
  document.querySelectorAll('[data-template-shortcut]').forEach(function (button) { button.addEventListener('click', function () { if (!busy() && !$(button.dataset.templateShortcut).disabled) $(button.dataset.templateShortcut).click(); }); });
  narrow.addEventListener('change', function () { if (!narrow.matches) closeNavigation(); }); $('group-tabs').addEventListener('click', function () { if (view === 'templates') setView('effects', false); else closeNavigation(); }); $('group-tabs').addEventListener('keydown', function (event) { if (view === 'templates' && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) setView('effects', false); });
  document.addEventListener('keydown', function (event) { if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f' || document.querySelector('dialog[open]')) return; event.preventDefault(); event.stopImmediatePropagation(); if (view === 'templates') setView('effects', false); var search = isMedia() ? $('media-collection-search') : $('main-search'); search.focus(); search.select(); }, true);
  ['dragover', 'drop'].forEach(function (name) { window.addEventListener(name, function (event) { event.preventDefault(); }); });
  window.addEventListener('cardreveal:library-changed', sync); window.addEventListener('cardreveal:busy', sync);
  window.CardDiscordUI = { getView: function () { return view; }, showView: function (next) { setView(next, false); }, openNavigation: openNavigation, openTemplates: function () { setView('templates', false); } };
  sync();
}());
