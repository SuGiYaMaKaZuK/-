(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Library = window.CardLibraryPanel, Panel = window.CardPanel, view = 'all', titleBusy = false, previewItem = null;
  var navigation = { node: $('channel-sidebar'), slot: $('channel-sidebar-slot'), dialog: $('channels-drawer'), toggle: $('toggle-channel-sidebar') };
  var narrowNavigation = window.matchMedia('(max-width: 760px)');
  function busy() { return Panel.isBusy() || titleBusy; }
  function restore(drawer) { if (drawer.node.parentNode !== drawer.slot) drawer.slot.appendChild(drawer.node); drawer.toggle.setAttribute('aria-expanded', 'false'); }
  function close(drawer) { if (drawer.dialog.open) drawer.dialog.close(); restore(drawer); }
  function open(drawer, media) {
    if (busy() || !media.matches || document.querySelector('dialog[open]')) return;
    drawer.dialog.appendChild(drawer.node); drawer.dialog.showModal(); drawer.toggle.setAttribute('aria-expanded', 'true');
    var selected = drawer.node.querySelector('[aria-current="page"]') || drawer.node.querySelector('button:not(:disabled)'); if (selected) selected.focus();
  }
  function setView(next, focus) {
    if (busy() || ['all', 'effects', 'titles', 'templates', 'videos', 'images'].indexOf(next) < 0) return;
    if ((next === 'videos' || next === 'images') && next !== view) $('media-collection-search').value = '';
    view = next; document.querySelector('.studio-layout').dataset.view = next;
    document.querySelector('.main-saved-section').hidden = next === 'titles'; document.querySelector('.telop-library').hidden = next === 'effects';
    document.querySelector('.saved-library').hidden = ['templates', 'videos', 'images'].indexOf(next) >= 0; $('template-panel-slot').hidden = next !== 'templates'; $('media-collection').hidden = next !== 'videos' && next !== 'images';
    document.querySelectorAll('[data-library-view]').forEach(function (button) { if (button.dataset.libraryView === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $('workspace-title').textContent = next === 'effects' ? '演出' : next === 'titles' ? 'テロップ' : next === 'templates' ? '元になるプラグイン' : next === 'videos' ? '作成に使用する動画' : next === 'images' ? '作成に使用した画像' : '作成済みのプラグイン';
    if (next === 'titles') $('timeline-trial-tools').open = true;
    close(navigation);
    sync(); if (focus) (next === 'titles' ? $('title-search') : next === 'templates' ? $('template-cards') : $('main-search')).focus({ preventScroll: true });
  }
  function sync() {
    var state = Library.getState(), group = state.groups.find(function (item) { return item.id === state.activeGroupId; }) || state.groups[0];
    var effects = state.presets.filter(function (item) { return item.groupId === group.id; }).length, titles = (state.titles || []).filter(function (item) { return item.groupId === group.id; }).length;
    $('sidebar-group-name').textContent = group.name; $('sidebar-group-name').title = group.name;
    $('workspace-group-name').textContent = view === 'videos' || view === 'images' ? '登録・使用済みの素材' : group.name + (view === 'templates' ? ' に保存できます' : ' の保存済みアイテム');
    $('channel-effect-count').textContent = effects; $('channel-title-count').textContent = titles; $('channel-all-count').textContent = effects + titles; $('channel-asset-count').textContent = (state.assets || []).length;
    document.querySelectorAll('[data-library-view],[data-template-shortcut],#toggle-channel-sidebar,#toggle-template-panel,#library-home-button,#open-video-library,#open-image-library,#media-collection-manage,#media-preview-manage').forEach(function (button) { button.disabled = busy(); });
    document.querySelectorAll('[data-template-shortcut]').forEach(function (button) { button.disabled = busy() || (button.dataset.templateShortcut === 'register-title' && !Library.isAvailable()); });
    $('timeline-tools-badge').textContent = $('timeline-trial-enabled').checked ? '試験モード ON' : '試験機能';
    var media = window.CardMediaLibrary.collect(state), current = view === 'templates' ? 'toggle-template-panel' : view === 'videos' ? 'open-video-library' : view === 'images' ? 'open-image-library' : 'library-home-button';
    document.querySelectorAll('.rail-category').forEach(function (button) { if (button.id === current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $('rail-video-count').textContent = media.filter(function (item) { return item.mediaType === 'video'; }).length;
    $('rail-image-count').textContent = media.filter(function (item) { return item.mediaType === 'image'; }).length;
    if (view === 'videos' || view === 'images') renderMedia(media);
  }
  function mediaURL(value) {
    if (/^(?:https?:|file:|blob:|data:(?:image|video)\/)/i.test(value)) return value;
    if (window.CardBridge.mediaURL) return window.CardBridge.mediaURL(value);
    if (/^[A-Za-z]:[\\/]|^\\\\/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null;
    return new URL(value, window.location.href).href;
  }
  function mediaIcon(kind) { var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.classList.add('ui-icon'); icon.setAttribute('aria-hidden', 'true'); var use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', kind === 'video' ? '#i-film' : '#i-image'); icon.appendChild(use); return icon; }
  function renderMedia(all) {
    var kind = view === 'videos' ? 'video' : 'image', query = $('media-collection-search').value.trim().toLocaleLowerCase();
    var total = all.filter(function (item) { return item.mediaType === kind; }), items = total.filter(function (item) { return !query || (item.name + ' ' + item.filename + ' ' + item.usedBy.join(' ')).toLocaleLowerCase().indexOf(query) >= 0; });
    $('media-collection-title').textContent = kind === 'video' ? '作成に使用する動画' : '作成に使用した画像'; $('media-collection-count').textContent = query ? items.length + ' / ' + total.length : total.length;
    $('media-empty-heading').textContent = query ? '一致する素材はありません' : kind === 'video' ? 'まだ動画はありません' : 'まだ画像はありません'; $('media-collection-empty').hidden = !!items.length;
    var grid = $('media-collection-grid'); grid.textContent = '';
    items.forEach(function (item) {
      var article = document.createElement('article'); article.className = 'preset-tile media-tile';
      var button = document.createElement('button'); button.type = 'button'; button.className = 'preset-open'; button.disabled = busy(); button.setAttribute('aria-label', item.name + 'をプレビュー');
      var art = document.createElement('span'); art.className = 'preset-art media-art'; art.appendChild(mediaIcon(kind));
      if (kind === 'image') { var src = mediaURL(item.mediaPath); if (src) { var image = document.createElement('img'); image.alt = ''; image.loading = 'lazy'; image.src = src; image.onerror = function () { image.hidden = true; }; art.appendChild(image); } }
      var badge = document.createElement('span'); badge.className = 'preset-mode-badge'; badge.textContent = kind === 'video' ? '動画 · プレビュー' : '画像'; art.appendChild(badge); button.appendChild(art);
      var name = document.createElement('span'); name.className = 'preset-title'; name.textContent = item.name; name.title = item.filename; button.appendChild(name);
      var uses = document.createElement('span'); uses.className = 'preset-subtitle'; uses.textContent = item.usedBy.length ? item.usedBy.length + '件の演出で使用' : '素材と配置に登録済み'; button.appendChild(uses);
      button.addEventListener('click', function () { if (!busy()) showMedia(item); }); article.appendChild(button); grid.appendChild(article);
    });
  }
  function showMedia(item) {
    if (document.querySelector('dialog[open]')) return; previewItem = item;
    var image = $('media-preview-image'), video = $('media-preview-video'), error = $('media-preview-error'), src = mediaURL(item.mediaPath);
    $('media-preview-title').textContent = item.name; $('media-preview-kind').textContent = item.mediaType === 'video' ? '動画' : '画像'; $('media-preview-path').value = item.mediaPath;
    $('media-preview-uses').textContent = item.usedBy.length ? '使用している演出：' + item.usedBy.join('、') : '素材と配置に登録されています。';
    error.hidden = true; image.hidden = item.mediaType !== 'image'; video.hidden = item.mediaType !== 'video';
    function failed() { error.textContent = '素材を表示できません。元ファイルの場所を確認してください。'; error.hidden = false; }
    if (!src) failed(); else if (item.mediaType === 'image') { image.onerror = failed; image.src = src; } else { video.onerror = failed; video.muted = true; video.src = src; }
    $('media-preview-dialog').showModal();
  }
  $('media-collection-search').addEventListener('input', function () { renderMedia(window.CardMediaLibrary.collect(Library.getState())); });
  $('media-collection-search').addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); this.value = ''; renderMedia(window.CardMediaLibrary.collect(Library.getState())); } });
  $('media-collection-manage').addEventListener('click', function () { if (!busy()) $('open-assets-library').click(); });
  $('media-preview-manage').addEventListener('click', function () {
    if (busy()) return; var item = previewItem; $('media-preview-dialog').close(); $('open-assets-library').click();
    if (item && item.assetIds.length) { $('sabu-search').value = ''; $('sabu-search').dispatchEvent(new Event('input')); var button = Array.from(document.querySelectorAll('[data-sabu-edit]')).find(function (node) { return item.assetIds.indexOf(node.dataset.sabuEdit) >= 0; }); if (button) button.click(); }
  });
  $('media-preview-dialog').addEventListener('close', function () { if ($('media-preview-dialog').open) return; var video = $('media-preview-video'); video.pause(); video.onerror = null; video.removeAttribute('src'); video.load(); $('media-preview-image').onerror = null; $('media-preview-image').removeAttribute('src'); previewItem = null; });
  document.querySelectorAll('[data-library-view]').forEach(function (button) { button.addEventListener('click', function () { setView(button.dataset.libraryView, true); }); });
  $('library-home-button').addEventListener('click', function () { setView('all', false); });
  $('open-video-library').addEventListener('click', function () { setView('videos', false); });
  $('open-image-library').addEventListener('click', function () { setView('images', false); });
  $('toggle-channel-sidebar').addEventListener('click', function () { open(navigation, narrowNavigation); });
  $('toggle-template-panel').addEventListener('click', function () { setView('templates', false); });
  $('close-channel-sidebar').addEventListener('click', function () { close(navigation); });
  $('close-template-panel').addEventListener('click', function () { setView('all', true); });
  [navigation].forEach(function (drawer) {
    drawer.dialog.addEventListener('close', function () { if (!drawer.dialog.open) restore(drawer); });
    drawer.dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(drawer); });
    drawer.dialog.addEventListener('click', function (event) { if (event.target !== drawer.dialog) return; var bounds = drawer.dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(drawer); });
  });
  // Close the drawer before an existing button opens an editor or registration
  // dialog. The original handlers and elements remain intact.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button'); if (!button || button.disabled) return;
    if (navigation.dialog.open && (button.id === 'open-assets-library' || button.id === 'rename-group' || button.id === 'delete-group' || button.dataset.templateShortcut)) close(navigation);
    if (view === 'templates' && (button.dataset.templateMode || button.id === 'register-title')) setView('all', false);
  }, true);
  document.querySelectorAll('[data-template-shortcut]').forEach(function (button) { button.addEventListener('click', function () { if (!busy() && !$(button.dataset.templateShortcut).disabled) $(button.dataset.templateShortcut).click(); }); });
  narrowNavigation.addEventListener('change', function () { if (!narrowNavigation.matches) close(navigation); });
  $('group-tabs').addEventListener('click', function () { if (['templates', 'videos', 'images'].indexOf(view) >= 0) setView('all', false); else close(navigation); });
  $('group-tabs').addEventListener('keydown', function (event) { if (['templates', 'videos', 'images'].indexOf(view) >= 0 && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) setView('all', false); });
  document.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f' || document.querySelector('dialog[open]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (view === 'templates') setView('all', false); var search = view === 'titles' ? $('title-search') : view === 'videos' || view === 'images' ? $('media-collection-search') : $('main-search'); search.focus(); search.select();
  }, true);
  window.addEventListener('cardreveal:library-changed', sync); window.addEventListener('cardreveal:busy', sync);
  window.addEventListener('cardreveal:timeline-trial-mode', sync);
  window.addEventListener('cardreveal:title-busy', function (event) { titleBusy = !!event.detail.busy; sync(); });
  window.CardDiscordUI = { getView: function () { return view; }, showView: function (next) { setView(next, false); }, openNavigation: function () { open(navigation, narrowNavigation); }, openTemplates: function () { setView('templates', false); } };
  sync();
}());
