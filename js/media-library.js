(function (root, factory) {
  var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardMediaLibrary = api;
}(typeof window !== 'undefined' ? window : this, function () {
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
      var project = preset.project || {}, cards = project.cards || [];
      if (project.mode === 'highlight') cards = cards.slice(0, 1); else if (project.mode === 'trapezoid') cards = cards.slice(0, 3);
      cards.forEach(function (card) { add(card, preset, null); });
    });
    return records;
  }
  return { collect: collect };
}));
