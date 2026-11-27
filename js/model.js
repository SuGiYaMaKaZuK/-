(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardModel = api;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';
  var serial = 0;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function card(index) {
    return { id: 'card-' + Date.now().toString(36) + '-' + (++serial), name: 'カード ' + (index + 1), mediaPath: '', mediaType: '', x: 480 + index * 480, y: 570, dropAt: index * 0.18, flipAt: 1.8 + index * 0.8, mediaOffset: 0, mediaScale:100, mediaX:0, mediaY:0 };
  }
  function createProject() {
    return upgrade({ version: 4, width: 1920, height: 1080, fps: 30, duration: 7, cardWidth: 320, cardHeight: 448, dropDuration: 0.8, flipDuration: 0.6, backColor: '#251b4d', borderColor: '#b9a0ff', cards: [card(0), card(1), card(2)] });
  }
  function highlightLayer(name,color,width,glow,offset,opacity) {
    return {id:'outline-'+Date.now().toString(36)+'-'+(++serial),name:name,color:color,width:width,glow:glow,offset:offset,opacity:opacity,enabled:true};
  }
  function defaultHighlight(project) {
    var w=Number.isFinite(project.width)?project.width:1920,h=Number.isFinite(project.height)?project.height:1080;
    return {x:w/2,y:h/2,width:Math.max(16,Math.round(w*.44)),height:Math.max(16,Math.round(h*.72)),rotation:0,shape:'rounded',radius:28,followAlpha:true,
      points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],layers:[
        highlightLayer('外側の光','#ffd642',0,6,2,.87),
        highlightLayer('金色の縁','#ffda3f',3,2,2,.95),
        highlightLayer('細い光の線','#fff3a6',2,0,1,.95)
      ]};
  }
  function upgrade(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
    if (project.mode === undefined) project.mode = 'cards';
    if (project.backgroundMode === undefined) project.backgroundMode = 'transparent';
    if (project.backgroundColor === undefined) project.backgroundColor = '#10131c';
    if (project.trapezoid === undefined) project.trapezoid = { angle: 8, borderWidth: 4, borderColor: '#ffffff', slideDuration: 0.8, interval: 0.25, startAt: 0 };
    if (project.highlight === undefined) project.highlight=defaultHighlight(project);
    if (Array.isArray(project.cards)) project.cards.forEach(function(c) {
      if (!c || typeof c !== 'object') return;
      if (c.mediaScale === undefined) c.mediaScale=100;
      if (c.mediaX === undefined) c.mediaX=0;
      if (c.mediaY === undefined) c.mediaY=0;
    });
    project.version = 4;
    return project;
  }
  function highlightPolygonValid(points) {
    if (!Array.isArray(points) || points.length<3 || points.length>12) return false;
    for(var i=0;i<points.length;i++) {
      var p=points[i],q=points[(i+1)%points.length];
      if(!p || !q || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<0 || p.x>1 || p.y<0 || p.y>1) return false;
      if(Math.hypot(p.x-q.x,p.y-q.y)<.00001) return false;
    }
    var area=0;
    for(var a=0;a<points.length;a++) {var b=points[(a+1)%points.length];area+=points[a].x*b.y-b.x*points[a].y;}
    if(Math.abs(area)/2<.002) return false;
    function cross(p,q,r) {return (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);}
    function on(p,q,r) {return Math.abs(cross(p,q,r))<1e-10 && r.x>=Math.min(p.x,q.x)-1e-10 && r.x<=Math.max(p.x,q.x)+1e-10 && r.y>=Math.min(p.y,q.y)-1e-10 && r.y<=Math.max(p.y,q.y)+1e-10;}
    for(var j=0;j<points.length;j++) for(var k=j+1;k<points.length;k++) {
      if(k===j+1 || (j===0 && k===points.length-1)) continue;
      var p1=points[j],q1=points[(j+1)%points.length],p2=points[k],q2=points[(k+1)%points.length];
      if((cross(p1,q1,p2)*cross(p1,q1,q2)<0 && cross(p2,q2,p1)*cross(p2,q2,q1)<0) || on(p1,q1,p2) || on(p1,q1,q2) || on(p2,q2,p1) || on(p2,q2,q1)) return false;
    }
    return true;
  }
  function addHighlightLayer(project) {
    upgrade(project);
    if(project.highlight.layers.length>=12) throw new Error('強調レイヤーは12枚まで追加できます。');
    var layer=highlightLayer('レイヤー '+(project.highlight.layers.length+1),'#ffffff',4,8,0,1);
    project.highlight.layers.push(layer);return layer.id;
  }
  function reorderHighlightLayer(project,from,to) {
    var layers=project.highlight.layers;
    if(from<0 || to<0 || from>=layers.length || to>=layers.length) return project;
    layers.splice(to,0,layers.splice(from,1)[0]);return project;
  }
  function addHighlightPoint(settings,afterIndex) {
    if(settings.points.length>=12) throw new Error('頂点は12個まで追加できます。');
    if(!Number.isInteger(afterIndex) || afterIndex<0 || afterIndex>=settings.points.length) {
      var longest=-1;afterIndex=0;
      settings.points.forEach(function(p,i) {var q=settings.points[(i+1)%settings.points.length],d=Math.hypot((p.x-q.x)*settings.width,(p.y-q.y)*settings.height);if(d>longest){longest=d;afterIndex=i;}});
    }
    var a=settings.points[afterIndex],b=settings.points[(afterIndex+1)%settings.points.length];
    settings.points.splice(afterIndex+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});return afterIndex+1;
  }
  function removeHighlightPoint(settings,index) {
    if(settings.points.length<=3) throw new Error('形を作るには3個以上の頂点が必要です。');
    if(!Number.isInteger(index) || index<0 || index>=settings.points.length) return settings;
    var proposed=settings.points.filter(function(_,i){return i!==index;});
    if(!highlightPolygonValid(proposed)) throw new Error('この頂点を消すと形が交差します。別の頂点を選んでください。');
    settings.points=proposed;return settings;
  }
  function mediaRect(c, sourceWidth, sourceHeight, frameWidth, frameHeight) {
    if (!(sourceWidth>0 && sourceHeight>0 && frameWidth>0 && frameHeight>0)) return {x:0,y:0,width:0,height:0};
    var zoom = c.mediaScale === undefined ? 100 : c.mediaScale;
    var factor = Math.max(frameWidth/sourceWidth,frameHeight/sourceHeight)*zoom/100;
    var width=Math.max(1,Math.round(sourceWidth*factor)), height=Math.max(1,Math.round(sourceHeight*factor));
    return {x:Math.round((frameWidth-width)/2+(c.mediaX===undefined?0:c.mediaX)), y:Math.round((frameHeight-height)/2+(c.mediaY===undefined?0:c.mediaY)), width:width,height:height};
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
    if (mode !== 'cards' && mode !== 'trapezoid' && mode !== 'highlight') throw new Error('演出の種類が正しくありません。');
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
    if (p.mode !== undefined && p.mode !== 'cards' && p.mode !== 'trapezoid' && p.mode !== 'highlight') errors.push('演出の種類が正しくありません。');
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
    if (p.mode==='highlight') {
      var h=p.highlight;
      if(!h || typeof h!=='object' || Array.isArray(h)) errors.push('画像の強調設定がありません。');
      else {
        range(h,'width',16,3840,'強調する画像の幅',true);range(h,'height',16,2160,'強調する画像の高さ',true);
        range(h,'x',-2*p.width,2*p.width,'強調画像のX位置');range(h,'y',-2*p.height,2*p.height,'強調画像のY位置');
        range(h,'rotation',-180,180,'画像の回転');range(h,'radius',0,500,'角の丸み');
        if(h.followAlpha!==undefined && typeof h.followAlpha!=='boolean') errors.push('透過素材の輪郭設定を確認してください。');
        if(['rounded','rectangle','polygon'].indexOf(h.shape)<0) errors.push('強調する形を選んでください。');
        if(!highlightPolygonValid(h.points)) errors.push('頂点は3〜12個で、線が交差しない形にしてください。');
        if(!Array.isArray(h.layers) || h.layers.length>12) errors.push('強調レイヤーは0〜12枚にしてください。');
        else {
          var layerIds=Object.create(null);
          h.layers.forEach(function(l,i) {
            var label='強調レイヤー'+(i+1)+'：';
            if(!l || typeof l!=='object') {errors.push(label+'設定が正しくありません。');return;}
            if(typeof l.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(l.id) || layerIds[l.id]) errors.push(label+'IDが空か重複しています。');
            layerIds[l.id]=true;
            if(typeof l.name!=='string' || l.name.length>100) errors.push(label+'名前は100文字以内にしてください。');
            if(typeof l.enabled!=='boolean') errors.push(label+'表示・非表示を選んでください。');
            if(!/^#[0-9a-f]{6}$/i.test(l.color || '')) errors.push(label+'色は6桁のカラーコードで指定してください。');
            range(l,'width',0,80,label+'線の太さ');range(l,'glow',0,80,label+'光の広がり');
            range(l,'offset',-80,120,label+'枠からの距離');range(l,'opacity',0,1,label+'不透明度');
          });
        }
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
      range(c,'dropAt',0,p.mode === 'trapezoid' || p.mode === 'highlight' ? 120 : p.duration,label+'登場時刻'); range(c,'flipAt',0,p.mode === 'trapezoid' || p.mode === 'highlight' ? 120 : p.duration,label+'めくる時刻');
      range(c,'mediaOffset',0,86400,label+'素材の開始位置');
      if (c.mediaScale !== undefined) range(c,'mediaScale',10,400,label+'素材の大きさ');
      if (c.mediaX !== undefined) range(c,'mediaX',-2*p.width,2*p.width,label+'素材のX位置');
      if (c.mediaY !== undefined) range(c,'mediaY',-2*p.height,2*p.height,label+'素材のY位置');
      if (p.mode !== 'trapezoid' && p.mode !== 'highlight' && c.flipAt < c.dropAt) errors.push(label + 'めくる時刻は登場時刻以降にしてください。');
      if (p.mode !== 'trapezoid' && p.mode !== 'highlight' && (c.dropAt + p.dropDuration > p.duration + 1e-8 || c.flipAt + p.flipDuration > p.duration + 1e-8)) errors.push(label + '演出の長さ内に降下・めくりが終わるようにしてください。');
      if (typeof c.mediaPath !== 'string' || c.mediaPath.indexOf('\u0000') !== -1) errors.push(label + '素材のパスが正しくありません。');
      if (['','image','video'].indexOf(c.mediaType) < 0 || (!!c.mediaPath && !c.mediaType)) errors.push(label + '素材の種類が正しくありません。');
    });
    return errors;
  }
  return { createProject:createProject, upgrade:upgrade, validate:validate, pose:pose, mediaRect:mediaRect, resizeCards:resizeCards, reorder:reorder, layout:layout, arrange:arrange, sequence:sequence, setMode:setMode, splitPolygons:splitPolygons, splitPose:splitPose, defaultHighlight:defaultHighlight, highlightLayer:highlightLayer, highlightPolygonValid:highlightPolygonValid, addHighlightLayer:addHighlightLayer, reorderHighlightLayer:reorderHighlightLayer, addHighlightPoint:addHighlightPoint, removeHighlightPoint:removeHighlightPoint };
}));
