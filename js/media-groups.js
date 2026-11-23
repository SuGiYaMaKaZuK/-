(function (root, factory) {
  var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardMediaGroups = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function label(value) { value = String(value || '').trim().replace(/^#+\s*/, '').trim(); if (!value || value.length > 40) throw new Error('グループ名を1〜40文字で入力してください。'); return value; }
  function kind(value) { if (value !== 'image' && value !== 'video') throw new Error('画像か動画のグループを選択してください。'); return value; }
  function create() { var value = { version: 1 }; ['image', 'video'].forEach(function (type) { var id = type + '-ungrouped'; value[type] = { groups: [{ id: id, name: '未分類' }], activeGroupId: id, assignments: [] }; }); return value; }
  function validate(value) {
    if (!value || value.version !== 1) throw new Error('素材グループの保存形式を確認してください。');
    ['image', 'video'].forEach(function (type) {
      var section = value[type], ids = Object.create(null), names = Object.create(null), paths = Object.create(null);
      if (!section || !Array.isArray(section.groups) || !section.groups.length || !Array.isArray(section.assignments)) throw new Error('素材グループの保存データを確認してください。');
      section.groups.forEach(function (group) { if (!group || typeof group.id !== 'string' || !group.id || group.id.length > 200 || ids[group.id] || typeof group.name !== 'string' || label(group.name) !== group.name || names[group.name]) throw new Error('素材グループの名前やIDが重複しています。'); ids[group.id] = true; names[group.name] = true; });
      if (!ids[section.activeGroupId]) throw new Error('選択中の素材グループが見つかりません。');
      section.assignments.forEach(function (item) { if (!item || typeof item.mediaPath !== 'string' || !item.mediaPath || item.mediaPath.length > 32768 || /\u0000/.test(item.mediaPath) || paths[item.mediaPath] || !ids[item.groupId]) throw new Error('素材のグループ分けを確認してください。'); paths[item.mediaPath] = true; });
    }); return value;
  }
  function section(state, type) { kind(type); if (state.mediaGroups === undefined) state.mediaGroups = create(); validate(state.mediaGroups); return state.mediaGroups[type]; }
  function find(value, id) { var result = value.groups.find(function (group) { return group.id === id; }); if (!result) throw new Error('素材の移動先グループが見つかりません。'); return result; }
  function add(state, type, name) { var value = section(state, type), name = label(name); if (value.groups.some(function (group) { return group.name === name; })) throw new Error('同じ名前の素材グループがあります。'); var group = { id: type + '-group-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), name: name }; value.groups.push(group); value.activeGroupId = group.id; return group; }
  function rename(state, type, id, name) { var value = section(state, type), target = find(value, id), name = label(name); if (value.groups.some(function (group) { return group.id !== id && group.name === name; })) throw new Error('同じ名前の素材グループがあります。'); target.name = name; return target; }
  function select(state, type, id) { var value = section(state, type); find(value, id); value.activeGroupId = id; }
  function remove(state, type, id, targetId) { var value = section(state, type); find(value, id); if (value.groups.length === 1) throw new Error('最後の素材グループは削除できません。'); targetId = targetId || value.groups.find(function (group) { return group.id !== id; }).id; find(value, targetId); if (id === targetId) throw new Error('別の移動先を選んでください。'); value.assignments.forEach(function (item) { if (item.groupId === id) item.groupId = targetId; }); var wasDefault = value.groups[0].id === id; value.groups = value.groups.filter(function (group) { return group.id !== id; }); if (wasDefault && value.groups[0].id !== targetId) { var target = find(value, targetId); value.groups = [target].concat(value.groups.filter(function (group) { return group.id !== targetId; })); } if (value.activeGroupId === id) value.activeGroupId = targetId; }
  function assign(state, type, paths, id) {
    var value = section(state, type); find(value, id);
    if (!Array.isArray(paths) || !paths.length || paths.some(function (path) { return typeof path !== 'string' || !path || path.length > 32768 || /\u0000/.test(path); })) throw new Error('移動する素材を選択してください。');
    var next = value.assignments.map(function (item) { return { mediaPath: item.mediaPath, groupId: item.groupId }; });
    paths.forEach(function (path) { var item = next.find(function (item) { return item.mediaPath === path; }); if (item) item.groupId = id; else next.push({ mediaPath: path, groupId: id }); }); value.assignments = next;
  }
  function groupFor(state, type, path) { var value = section(state, type), assignment = value.assignments.find(function (item) { return item.mediaPath === path; }); return assignment ? assignment.groupId : value.groups[0].id; }
  return { create: create, validate: validate, section: section, add: add, rename: rename, select: select, remove: remove, assign: assign, groupFor: groupFor };
}));
