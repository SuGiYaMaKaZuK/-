(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardHistory = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  // JSON snapshots keep editable drafts independent of the undo/redo records.
  function create(limit) {
    limit = Number.isInteger(limit) && limit > 0 ? limit : 60;
    var entries = [], index = -1;
    function encode(value) { var result = JSON.stringify(value); if (result === undefined) throw new Error('履歴のデータを確認してください。'); return result; }
    function reset(value) { entries = [{ json: encode(value), key: null, at: 0 }]; index = 0; }
    function push(value, options) {
      options = options || {}; var json = encode(value), current = entries[index];
      if (current && current.json === json) return false;
      var branched = index < entries.length - 1;
      entries = entries.slice(0, index + 1);
      var key = typeof options.key === 'string' ? options.key : null, at = Number.isFinite(options.at) ? options.at : Date.now();
      var windowMs = Number.isFinite(options.windowMs) ? Math.max(0, options.windowMs) : 900;
      if (!branched && index > 0 && key && current.key === key && at >= current.at && at - current.at <= windowMs) {
        if (entries[index - 1].json === json) { entries.pop(); index--; }
        else entries[index] = { json: json, key: key, at: at };
      }
      else { entries.push({ json: json, key: key, at: at }); index++; }
      if (entries.length > limit + 1) { entries.shift(); index--; }
      return true;
    }
    function undo() { if (index <= 0) return null; index--; entries[index].key = null; return JSON.parse(entries[index].json); }
    function redo() { if (index >= entries.length - 1) return null; index++; entries[index].key = null; return JSON.parse(entries[index].json); }
    function visit(callback) { entries.forEach(function (entry) { callback(JSON.parse(entry.json)); }); }
    return { reset: reset, push: push, undo: undo, redo: redo, visit: visit, info: function () { return { undo: Math.max(0, index), redo: Math.max(0, entries.length - index - 1) }; } };
  }
  return { create: create };
}));
