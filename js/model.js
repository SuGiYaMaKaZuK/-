(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardModel = api;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';
  var serial = 0;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function card(index) {
    return { id: 'card-' + Date.now().toString(36) + '-' + (++serial), name: 'カード ' + (index + 1), mediaPath: '', mediaType: '', x: 480 + index * 480, y: 570, dropAt: index * 0.18, flipAt: 1.8 + index * 0.8, mediaOffset: 0 };
  }
  function createProject() {
    return upgrade({ version: 2, width: 1920, height: 1080, fps: 30, duration: 7, cardWidth: 320, cardHeight: 448, dropDuration: 0.8, flipDuration: 0.6, backColor: '#251b4d', borderColor: '#b9a0ff', cards: [card(0), card(1), card(2)] });
  }
  function upgrade(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
    if (project.mode === undefined) project.mode = 'cards';
    if (project.backgroundMode === undefined) project.backgroundMode = 'transparent';
    if (project.backgroundColor === undefined) project.backgroundColor = '#10131c';
    if (project.trapezoid === undefined) project.trapezoid = { angle: 8, borderWidth: 4, borderColor: '#ffffff', slideDuration: 0.8, interval: 0.25, startAt: 0 };
    project.version = 2;
    return project;
  }
  function layout(project) {
    var count = project.cards.length;
    var cols = Math.min(4, count), rows = Math.ceil(count / cols);
    var factor = Math.min(1, project.width / (cols * project.cardWidth * 1.35), project.height / (rows * project.cardHeight * 1.2));
    project.cardWidth = Math.max(16, Math.round(project.cardWidth * factor));
    project.cardHeight = Math.max(16, Math.round(project.cardHeight * factor));
    project.cards.forEach(function (c, i) {
      var row = Math.floor(i / cols), inRow = Math.min(cols, count - row * cols);
      c.x = Math.round(project.width * ((i % cols) + 1) / (inRow + 1));
      c.y = Math.round(project.height * (row + 0.5) / rows);
    });
    return project;
  }
  function resizeCards(project, count) {
    count = clamp(Math.round(Number(count) || 1), 1, 12);
    while (project.cards.length < count) {
      var c = card(project.cards.length);
      c.flipAt = project.cards.reduce(function (max, item) { return Math.max(max, item.flipAt); }, 1) + 0.8;
      var cols = Math.min(4, Math.ceil(Math.sqrt(count))), rows = Math.ceil(count / cols);
      c.x = clamp(Math.round(project.width * ((project.cards.length % cols) + 0.5) / cols), Math.min(project.width / 2, project.cardWidth / 2 + 16), Math.max(project.width / 2, project.width - project.cardWidth / 2 - 16));
      c.y = clamp(Math.round(project.height * (Math.floor(project.cards.length / cols) + 0.5) / rows), Math.min(project.height / 2, project.cardHeight / 2 + 16), Math.max(project.height / 2, project.height - project.cardHeight / 2 - 16));
      project.cards.push(c);
    }
    project.cards.length = count;
    project.duration = Math.max(project.duration, Math.ceil(Math.max.apply(null, project.cards.map(function (c) { return c.flipAt; })) + project.flipDuration + 1));
    return project;
  }
  function arrange(project, preset, selectedId) {
    if (preset === 'center') {
      project.cards.forEach(function(c) { if (!selectedId || c.id === selectedId) { c.x = project.width / 2; c.y = project.height / 2; } });
      return project;
    }
    var count = project.cards.length;
    var cols = preset === 'row' ? count : Math.min(4, Math.ceil(Math.sqrt(count)));
    var rows = Math.ceil(count / cols);
    var factor = Math.min(project.width / (cols * project.cardWidth * 1.25), project.height / (rows * project.cardHeight * 1.2));
    if (project.cardWidth * factor < 16 || project.cardHeight * factor < 16) throw new Error('この枚数を並べるには映像サイズを大きくしてください。');
    project.cardWidth = Math.round(project.cardWidth * factor);
    project.cardHeight = Math.round(project.cardHeight * factor);
    project.cards.forEach(function(c, i) {
      var row = Math.floor(i / cols), inRow = Math.min(cols, count - row * cols);
      c.x = Math.round(project.width * ((i % cols) + 0.5) / inRow);
      c.y = Math.round(project.height * (row + 0.5) / rows);
    });
    return project;
  }
  function sequence(project, start, interval) {
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(interval) || interval < 0.05 || interval > 10) throw new Error('開始時刻は0秒以上、めくる間隔は0.05〜10秒で指定してください。');
    start = Math.max(start, Math.max.apply(null, project.cards.map(function(c) { return c.dropAt; })));
    var end = Math.max(start + (project.cards.length - 1) * interval + project.flipDuration + 1, Math.max.apply(null,project.cards.map(function(c) { return c.dropAt + project.dropDuration; })));
    if (end > 120) throw new Error('演出が120秒以内に収まるよう、開始時刻や間隔を短くしてください。');
    project.cards.forEach(function(c, i) { c.flipAt = start + i * interval; });
    project.duration = Math.max(project.duration, Math.ceil(end));
    return project;
  }
  function setMode(project, mode) {
    if (mode !== 'cards' && mode !== 'trapezoid') throw new Error('演出の種類が正しくありません。');
    upgrade(project);
    if (mode === 'trapezoid' && project.cards.length < 3) resizeCards(project, 3);
    project.mode = mode;
    if (mode === 'trapezoid') project.duration = Math.max(project.duration, project.trapezoid.startAt + 2 * project.trapezoid.interval + project.trapezoid.slideDuration + 1);
    return project;
  }
  function splitPolygons(project) {
    var w = project.width, h = project.height;
    var angle = project.trapezoid ? project.trapezoid.angle : 8;
    var delta = clamp(Math.tan(angle * Math.PI / 180) * h, -w * 0.15, w * 0.24);
    var a = w / 3, b = 2 * w / 3;
    return [
      [{x:0,y:0},{x:a,y:0},{x:a-delta,y:h},{x:0,y:h}],
      [{x:a,y:0},{x:b,y:0},{x:b+delta,y:h},{x:a-delta,y:h}],
      [{x:b,y:0},{x:w,y:0},{x:w,y:h},{x:b+delta,y:h}]
    ];
  }
  function splitPose(project, index, t) {
    var options = project.trapezoid || { slideDuration:0.8, interval:0.25, startAt:0 };
    var dropAt = options.startAt + index * options.interval;
    var p = clamp((t - dropAt) / options.slideDuration, 0, 1);
    var item = project.cards[index];
    return { offsetY: p >= 1 ? 0 : -project.height * Math.pow(1 - p, 3), visible: t >= dropAt, front:true, mediaTime: (item ? item.mediaOffset : 0) + Math.max(0, t - dropAt), dropAt:dropAt };
  }
  function reorder(project, from, to) {
    if (from < 0 || to < 0 || from >= project.cards.length || to >= project.cards.length) return project;
    var times = project.cards.map(function (c) { return c.flipAt; }).sort(function (a,b) { return a-b; });
    var shift = Math.max(0, Math.max.apply(null, project.cards.map(function (c) { return c.dropAt; })) - times[0]);
    if (times[times.length - 1] + shift + project.flipDuration > 120) throw new Error('この順番では演出が120秒を超えます。登場時刻を早めるか、めくる間隔を短くしてから並べ替えてください。');
    project.cards.splice(to, 0, project.cards.splice(from, 1)[0]);
    project.cards.forEach(function (c, i) { c.flipAt = times[i] + shift; });
    project.duration = Math.max(project.duration, Math.ceil(times[times.length - 1] + shift + project.flipDuration));
    return project;
  }
  function pose(project, c, t) {
    var drop = clamp((t - c.dropAt) / project.dropDuration, 0, 1);
    var startY = -project.cardHeight / 2 - 40;
    var flip = clamp((t - c.flipAt) / project.flipDuration, 0, 1);
    var eased = flip * flip * (3 - 2 * flip);
    var scaleX = Math.max(2 / project.cardWidth, Math.abs(Math.cos(Math.PI * eased)));
    return { x: c.x, y: startY + (c.y - startY) * (1 - Math.pow(1 - drop, 3)), width: project.cardWidth * scaleX, height: project.cardHeight, scaleX: scaleX, front: t >= c.flipAt + project.flipDuration / 2, visible: t >= c.dropAt, mediaTime: c.mediaOffset + Math.max(0, t - c.flipAt - project.flipDuration / 2) };
  }
  function validate(p) {
    var errors = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['設定ファイルの形式が正しくありません。'];
    function range(obj, key, min, max, label, integer) {
      if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key]) || obj[key] < min || obj[key] > max || (integer && !Number.isInteger(obj[key]))) errors.push(label + 'は' + min + '〜' + max + (integer ? 'の整数' : '') + 'で指定してください。');
    }
    range(p,'width',64,3840,'映像の幅',true); range(p,'height',64,2160,'映像の高さ',true);
    if (p.width % 2 || p.height % 2) errors.push('映像の幅・高さは偶数にしてください。');
    range(p,'fps',1,120,'フレームレート',true); range(p,'duration',0.5,120,'演出の長さ');
    range(p,'cardWidth',16,3840,'カードの幅',true); range(p,'cardHeight',16,2160,'カードの高さ',true);
    range(p,'dropDuration',0.05,10,'降下時間'); range(p,'flipDuration',0.05,10,'めくり時間');
    ['backColor','borderColor'].forEach(function (key) { if (!/^#[0-9a-f]{6}$/i.test(p[key] || '')) errors.push('カードの色は6桁のカラーコードで指定してください。'); });
    if (p.mode !== undefined && p.mode !== 'cards' && p.mode !== 'trapezoid') errors.push('演出の種類が正しくありません。');
    if (p.backgroundMode !== undefined && p.backgroundMode !== 'transparent' && p.backgroundMode !== 'solid') errors.push('背景の種類が正しくありません。');
    if (p.backgroundColor !== undefined && !/^#[0-9a-f]{6}$/i.test(p.backgroundColor)) errors.push('背景の色は6桁のカラーコードで指定してください。');
    if (p.mode === 'trapezoid') {
      if (!p.trapezoid || typeof p.trapezoid !== 'object') errors.push('台形3分割の設定がありません。');
      else {
        range(p.trapezoid,'angle',-20,20,'斜めの角度'); range(p.trapezoid,'borderWidth',0,40,'境界線の太さ');
        range(p.trapezoid,'slideDuration',0.05,10,'登場にかける時間'); range(p.trapezoid,'interval',0,10,'登場の間隔'); range(p.trapezoid,'startAt',0,p.duration,'登場開始時刻');
        if (!/^#[0-9a-f]{6}$/i.test(p.trapezoid.borderColor || '')) errors.push('境界線の色は6桁のカラーコードで指定してください。');
        if (p.trapezoid.startAt + 2 * p.trapezoid.interval + p.trapezoid.slideDuration > p.duration + 1e-8) errors.push('3つの映像が登場し終わるよう、演出の長さを延ばしてください。');
      }
    }
    if (!Array.isArray(p.cards) || p.cards.length < 1 || p.cards.length > 12) { errors.push('カードは1〜12枚で指定してください。'); return errors; }
    if (p.mode === 'trapezoid' && p.cards.length < 3) errors.push('台形3分割には3つの素材枠が必要です。');
    var ids = Object.create(null);
    p.cards.forEach(function(c, i) {
      var label = 'カード' + (i + 1) + '：';
      if (!c || typeof c !== 'object') { errors.push(label + '形式が正しくありません。'); return; }
      if (typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id) || Object.prototype.hasOwnProperty.call(ids, c.id)) errors.push(label + 'IDが空か重複しています。');
      ids[c.id] = true;
      if (typeof c.name !== 'string' || c.name.length > 100) errors.push(label + '名前は100文字以内にしてください。');
      range(c,'x',-p.width,2*p.width,label+'X位置'); range(c,'y',-p.height,2*p.height,label+'Y位置');
      range(c,'dropAt',0,p.mode === 'trapezoid' ? 120 : p.duration,label+'登場時刻'); range(c,'flipAt',0,p.mode === 'trapezoid' ? 120 : p.duration,label+'めくる時刻');
      range(c,'mediaOffset',0,86400,label+'素材の開始位置');
      if (p.mode !== 'trapezoid' && c.flipAt < c.dropAt) errors.push(label + 'めくる時刻は登場時刻以降にしてください。');
      if (p.mode !== 'trapezoid' && (c.dropAt + p.dropDuration > p.duration + 1e-8 || c.flipAt + p.flipDuration > p.duration + 1e-8)) errors.push(label + '演出の長さ内に降下・めくりが終わるようにしてください。');
      if (typeof c.mediaPath !== 'string' || c.mediaPath.indexOf('\u0000') !== -1) errors.push(label + '素材のパスが正しくありません。');
      if (['','image','video'].indexOf(c.mediaType) < 0 || (!!c.mediaPath && !c.mediaType)) errors.push(label + '素材の種類が正しくありません。');
    });
    return errors;
  }
  return { createProject:createProject, upgrade:upgrade, validate:validate, pose:pose, resizeCards:resizeCards, reorder:reorder, layout:layout, arrange:arrange, sequence:sequence, setMode:setMode, splitPolygons:splitPolygons, splitPose:splitPose };
}));
