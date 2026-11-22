(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardTimelineModel = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function identity(value) { return typeof value === 'string' && !!value && value.length <= 200 && !/[\u0000-\u001f]/.test(value); }
  function ticks(value, positive) { return typeof value === 'string' && /^\d{1,32}$/.test(value) && (!positive || /[1-9]/.test(value)); }
  function after(a, b) { a = a.replace(/^0+/, '') || '0'; b = b.replace(/^0+/, '') || '0'; return a.length > b.length || a.length === b.length && a > b; }
  function validateFormat(value) {
    if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 16 || value.height < 16 || value.width > 16384 || value.height > 16384 || !ticks(value.timebase, true)) throw new Error('元のシーケンスの画面サイズ・fpsを確認できません。');
  }
  function validateCandidate(value) {
    validateFormat(value);
    if (!identity(value.projectId) || !identity(value.sequenceId) || !identity(value.clipId) || (typeof value.clipName!=='string' || !value.clipName.trim() || value.clipName.length>1000) || !Number.isInteger(value.trackIndex) || value.trackIndex < 0 || !Number.isInteger(value.clipIndex) || value.clipIndex < 0 || !ticks(value.startTicks) || !ticks(value.endTicks) || !after(value.endTicks, value.startTicks)) throw new Error('選択したクリップの識別情報を確認できません。もう一度選択してください。');
    return value;
  }
  function validateTemplate(value) { validateFormat(value); if (!identity(value.sequenceId) || !ticks(value.durationTicks, true)) throw new Error('試験テロップの保存情報を確認できません。'); return value; }
  return { validateCandidate: validateCandidate, validateTemplate: validateTemplate, ticks: ticks };
}));
