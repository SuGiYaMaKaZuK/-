(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var library = window.CardLibraryPanel, folders = window.CardMediaGroups, dialog = $('group-actions-dialog');
  var menu = $('group-action-options'), nameField = $('group-action-name'), apply = $('group-action-apply');
  var context = null, action = null, destination = null;
  function groupList(state, type) { return type === 'plugin' ? state.groups : folders.section(state, type).groups; }
  function groupAt(list, id) { return list.find(function (group) { return group.id === id; }); }
  function check(group, original) {
    if (!group || group.name !== original.name) throw new Error('グループが別の画面で変更されました。×で閉じて開き直してください。');
  }
  function position() {
    if (!context || !dialog.open) return;
    var bounds = dialog.getBoundingClientRect(), margin = 8;
    dialog.style.left = Math.max(margin, Math.min(context.x, window.innerWidth - bounds.width - margin)) + 'px';
    dialog.style.top = Math.max(margin, Math.min(context.y, window.innerHeight - bounds.height - margin)) + 'px';
  }
  function open(event, button, keyboard) {
    event.preventDefault();
    if (window.CardPanel.isBusy() || !library.isAvailable() || dialog.open) return;
    var type = button.dataset.group ? 'plugin' : window.CardDiscordUI.getView() === 'videos' ? 'video' : 'image';
    var id = button.dataset.group || button.dataset.mediaGroup, list = groupList(library.getState(), type), group = groupAt(list, id);
    if (!group) return;
    var rect = button.getBoundingClientRect();
    context = { type: type, id: id, name: group.name, x: keyboard ? rect.left : event.clientX, y: keyboard ? rect.bottom : event.clientY };
    action = null; destination = null;
    menu.hidden = false; $('group-rename-field').hidden = true; nameField.disabled = true;
    $('group-action-footer').hidden = true; $('group-delete-copy').hidden = true; $('group-action-error').textContent = '';
    $('group-action-title').textContent = group.name;
    $('group-action-delete').disabled = list.length < 2;
    $('group-action-delete').title = list.length < 2 ? '最後のグループは削除できません' : '';
    dialog.showModal(); position(); $('group-action-rename').focus();
  }
  function onGroup(event) { return event.target.closest('button[data-group],button[data-media-group]'); }
  var sidebar = $('channel-sidebar');
  sidebar.addEventListener('contextmenu', function (event) {
    var button = onGroup(event);
    if (button) open(event, button, !event.clientX && !event.clientY);
  });
  sidebar.addEventListener('keydown', function (event) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    var button = onGroup(event);
    if (button) open(event, button, true);
  });
  function choose(next) {
    if (!context || window.CardPanel.isBusy()) return;
    var list = groupList(library.getState(), context.type);
    try { check(groupAt(list, context.id), context); }
    catch (error) { $('group-action-error').textContent = error.message; position(); return; }
    var deleting = next === 'delete';
    destination = deleting ? list.find(function (group) { return group.id !== context.id; }) : null;
    if (deleting && !destination) return;
    action = next; menu.hidden = true; $('group-action-footer').hidden = false;
    $('group-action-title').textContent = deleting ? '「' + context.name + '」を削除しますか？' : 'グループ名を変更';
    $('group-rename-field').hidden = deleting; nameField.disabled = deleting;
    $('group-delete-copy').hidden = !deleting; $('group-action-error').textContent = '';
    apply.className = deleting ? 'danger-button' : 'save-group-button';
    apply.textContent = deleting ? '削除する' : '変更を保存';
    if (deleting) {
      $('group-delete-copy').textContent = '中の' + (context.type === 'plugin' ? '演出' : '素材') + 'は「' + destination.name + '」に移ります。';
      dialog.querySelector('.group-close').focus();
    } else { nameField.value = context.name; nameField.focus(); nameField.select(); }
    position();
  }
  $('group-action-rename').addEventListener('click', function () { choose('rename'); });
  $('group-action-delete').addEventListener('click', function () { choose('delete'); });
  $('group-action-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!context || !action || window.CardPanel.isBusy()) return;
    try {
      library.commit(function (state) {
        var list = groupList(state, context.type);
        check(groupAt(list, context.id), context);
        if (action === 'rename') {
          if (context.type === 'plugin') window.CardLibrary.renameGroup(state, context.id, nameField.value);
          else folders.rename(state, context.type, context.id, nameField.value);
        } else {
          check(groupAt(list, destination.id), destination);
          if (context.type === 'plugin') window.CardLibrary.removeGroup(state, context.id, destination.id);
          else folders.remove(state, context.type, context.id, destination.id);
        }
      });
      $('status-text').textContent = action === 'rename' ? 'グループ名を変更しました。' : 'グループを削除しました。';
      $('status').classList.remove('error'); dialog.close();
    } catch (error) {
      $('group-action-error').textContent = error.name === 'QuotaExceededError' ? '保存容量がいっぱいです。整理してから再度お試しください。' : error.message;
      position();
    }
  });
  dialog.addEventListener('close', function () {
    if (dialog.open || !context) return;
    var tabs = context.type === 'plugin' ? $('group-tabs') : $('media-group-tabs');
    var origin = Array.from(tabs.children).find(function (button) { return (button.dataset.group || button.dataset.mediaGroup) === context.id; });
    var focus = origin || tabs.querySelector('[aria-selected=true]');
    if (focus && focus.getClientRects().length) focus.focus({ preventScroll: true });
    context = null; action = null; destination = null;
  });
  window.addEventListener('resize', position);
}());
