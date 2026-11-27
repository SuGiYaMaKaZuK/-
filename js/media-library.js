(function (root, factory) {
  var library = root.CardLibrary, groups = root.CardMediaGroups, model = root.CardModel;
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) {
    library = require('./library'); groups = require('./media-groups'); model = require('./model');
  }
  var api = factory(library, groups, model); if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardMediaLibrary = api;
}(typeof window !== 'undefined' ? window : this, function (library, groups, model) {
  'use strict';
  function collect(state) {
    state = state || {};
    var records = [], lookup = Object.create(null);
    function add(source, preset, asset) {
      if (!source || typeof source.mediaPath !== 'string' || !source.mediaPath || ['image', 'video'].indexOf(source.mediaType) < 0) return;
      var key = source.mediaType + ':' + source.mediaPath, item = lookup[key];
      if (!item) {
        var filename = source.mediaPath.split(/[\\/]/).pop().split('?')[0];
        try { filename = decodeURIComponent(filename); } catch (ignored) {}
        item = { key: key, mediaPath: source.mediaPath, mediaType: source.mediaType, name: source.sourceName || source.name || filename || '素材', filename: filename, assetIds: [], presetIds: [], usedBy: [] };
        records.push(item); lookup[key] = item;
      }
      if (asset && item.assetIds.indexOf(asset.id) < 0) item.assetIds.push(asset.id);
      if (preset && item.presetIds.indexOf(preset.id) < 0) { item.presetIds.push(preset.id); item.usedBy.push(preset.name); }
    }
    (state.assets || []).forEach(function (asset) { add(asset, null, asset); });
    (state.presets || []).forEach(function (preset) {
      model.activeCards(preset.project || {}).forEach(function (card) { add(card, preset, null); });
    });
    return records;
  }
  function localKey(type, path) {
    if (/^(?:[a-z]:[\\/]|\\\\)/i.test(path)) path = path.replace(/\//g, '\\').toLowerCase();
    return type + ':' + path;
  }
  // The caller commits the complete batch (new placements and group memberships) in one transaction.
  function register(state, files, destinations) {
    var known = new Map(), seen = new Set(), names = state.assets.map(function (asset) { return asset.name; });
    var paths = { image: [], video: [] }, result = [];
    collect(state).forEach(function (item) {
      var key = localKey(item.mediaType, item.mediaPath);
      if (!known.has(key)) known.set(key, item);
    });
    files.forEach(function (file) {
      var key = localKey(file.type, file.path);
      if (seen.has(key)) return;
      seen.add(key);
      var item = known.get(key), path = item ? item.mediaPath : file.path;
      if (!item || !item.assetIds.length) {
        var name = library.availableName(file.name, names);
        library.savePlacement(state, {
          name: name, sourceName: file.name, mediaPath: path, mediaType: file.type,
          mediaScale: 100, mediaX: 0, mediaY: 0, referenceWidth: 1920, referenceHeight: 1080,
          frameWidth: 960, frameHeight: 540
        });
        names.push(name);
      }
      paths[file.type].push(path);
    });
    ['image', 'video'].forEach(function (type) {
      if (!paths[type].length) return;
      var section = groups.section(state, type);
      var id = destinations ? destinations[type] : section.activeGroupId;
      var target = section.groups.find(function (group) { return group.id === id; });
      if (!target) throw new Error('登録先のグループが別の画面で変更されました。登録先を選び直してください。');
      groups.assign(state, type, paths[type], target.id);
      result.push({ type: type, count: paths[type].length, groupName: target.name });
    });
    return result;
  }
  return { collect: collect, register: register };
}));
