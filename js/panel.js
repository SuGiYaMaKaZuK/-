(function () {
  'use strict';
  var Model=window.CardModel,Bridge=window.CardBridge || {hasHost:false};
  var $=function(id){return document.getElementById(id);};
  var project=Model.createProject(),selected=project.cards[0].id,currentTime=0,playing=false,renderBusy=false,lastTick=0,drag=null,dirty=false,lastOutput=null;
  var playbackFrame=null;
  var selectedLayer=null,selectedPoint=0,polygonEditing=false,highlightCache=null,highlightTimer=null,highlightPending=false;
  var media={},pendingCard=null,canvas=$('preview'),ctx=canvas.getContext('2d');
  var palette=['#7546b8','#157d8d','#ad5c2d','#5374ad'];
  var history=window.CardHistory.create(60),historyReady=false,historyPending=false,historyQueued=false,historyKey=null,historyWindow=900,historyEpoch=0,editContext=null,editSession=0,ownedURLs={};
  function snapshot(){var sources={};Object.keys(media).sort().forEach(function(id){var item=media[id],c=cardByID(id);if(c)sources[id]={path:item.path,url:item.url,type:c.mediaType,objectURL:item.objectURL};});return {project:project,sources:sources};}
  function pruneURLs(){var keep={};Object.keys(media).forEach(function(id){keep[media[id].url]=true;});history.visit(function(value){Object.keys(value.sources || {}).forEach(function(id){keep[value.sources[id].url]=true;});});Object.keys(ownedURLs).forEach(function(url){if(!keep[url]){URL.revokeObjectURL(url);delete ownedURLs[url];}});}
  function syncHistory(){var info=history.info();$('undo-edit').disabled=renderBusy || !!drag || !info.undo;$('redo-edit').disabled=renderBusy || !!drag || !info.redo;$('history-count').textContent=info.undo?'履歴 '+info.undo+' / 60':'設定・配置の履歴';}
  function flushHistory(){if(!historyReady || !historyPending || drag)return;historyPending=false;history.push(snapshot(),{key:historyKey,windowMs:historyWindow});pruneURLs();syncHistory();window.dispatchEvent(new CustomEvent('cardreveal:state'));}
  function edited(key,windowMs){dirty=true;if(!historyReady)return;historyPending=true;historyKey=key===undefined?(editContext && editContext.key):key;historyWindow=windowMs || 900;if(historyQueued || drag)return;historyQueued=true;var epoch=historyEpoch;Promise.resolve().then(function(){if(epoch!==historyEpoch)return;historyQueued=false;flushHistory();});}
  function resetHistory(){historyEpoch++;historyPending=false;historyQueued=false;history.reset(snapshot());pruneURLs();syncHistory();}
  document.addEventListener('focusin',function(){editSession++;});
  ['input','change'].forEach(function(type){document.addEventListener(type,function(event){if(!$('editor-dialog').contains(event.target))return;var t=event.target;if(!t.matches('input,select'))return;var identity=t.id || [t.dataset.card,t.dataset.field,t.dataset.highlightSetting,t.dataset.layerSetting].join(':');var context={key:'field:'+identity+':'+editSession};editContext=context;Promise.resolve().then(function(){if(editContext===context)editContext=null;});},true);});
  function restoreHistory(value){setPlaying(false);Object.keys(media).forEach(releaseMedia);project=value.project;if(!cardByID(selected))selected=project.cards[0].id;selectedPoint=Math.min(selectedPoint,project.highlight.points.length-1);polygonEditing=polygonEditing && isHighlight() && project.highlight.shape==='polygon';highlightPending=false;highlightCache=null;clearTimeout(highlightTimer);Object.keys(value.sources || {}).forEach(function(id){var c=cardByID(id);if(c)loadMedia(c,value.sources[id]);});synchronizeMedia();dirty=true;syncSettings();pruneURLs();syncHistory();window.dispatchEvent(new CustomEvent('cardreveal:state'));}
  function stepHistory(forward){if(renderBusy || drag)return;flushHistory();var value=forward?history.redo():history.undo();if(!value)return;restoreHistory(value);status(forward?'設定・配置をやり直しました。':'設定・配置を元に戻しました。');}
  $('undo-edit').addEventListener('click',function(){stepHistory(false);});$('redo-edit').addEventListener('click',function(){stepHistory(true);});
  function textInput(target){return target && (target.isContentEditable || target.matches('textarea,input:not([type=range]):not([type=checkbox]):not([type=color]),select'));}
  document.addEventListener('keydown',function(event){if(event.defaultPrevented || !$('editor-dialog').open || document.querySelector('dialog[open]:not(#editor-dialog)') || textInput(event.target))return;var key=event.key.toLowerCase();if((event.ctrlKey || event.metaKey) && !event.altKey && (key==='z' || key==='y')){event.preventDefault();stepHistory(key==='y' || event.shiftKey);return;}if(event.key===' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('button,summary,input')){event.preventDefault();if(!renderBusy)$('play').click();}});
  window.addEventListener('beforeunload',function(){Object.keys(ownedURLs).forEach(function(url){URL.revokeObjectURL(url);});});
  function status(message,error){$('status-text').textContent=message;$('status').classList.toggle('error',!!error);if($('editor-status')){$('editor-status').textContent=message;$('editor-status').classList.toggle('error',!!error);}window.dispatchEvent(new CustomEvent('cardreveal:state'));}
  function defaultRenderNote(){return Bridge.hasHost?'プロジェクトに読み込んだら、タイムラインへドラッグして使えます。':'書き出しはPremiere Proのパネルで行えます。ここでは動きをお試しください。';}
  function reportError(error,friendly){var message=error.message || String(error);$('error-details').hidden=false;$('error-text').textContent=error.technicalDetails || message;status(message?message.slice(0,240):(friendly || '操作を完了できませんでした。「エラーの詳細」を確認してください。'),true);}
  function number(value,fallback){var n=Number(value);return Number.isFinite(n)?n:fallback;}
  function text(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fileURL(p){if(/^(blob:|data:|https?:|file:)/i.test(p || ''))return p;return encodeURI('file:///'+String(p).replace(/\\/g,'/').replace(/^\/+/, '')).replace(/#/g,'%23').replace(/\?/g,'%3F');}
  function mediaURL(p){return Bridge.mediaURL?Bridge.mediaURL(p):fileURL(p);}
  function isSplit(){return project.mode==='trapezoid';}
  function isHighlight(){return project.mode==='highlight';}
  function splitSettings(){return project.trapezoid || {angle:8,borderWidth:4,borderColor:'#ffffff',slideDuration:.8,interval:.25,startAt:0};}
  function activeCards(){return isHighlight()?project.cards.slice(0,1):(isSplit()?project.cards.slice(0,3):project.cards);}
  function cardByID(id){return project.cards.find(function(c){return c.id===id;});}
  function releaseMedia(id){var item=media[id];if(!item)return;if(item.alphaController)item.alphaController.abort();if(item.el.tagName==='VIDEO'){item.el.pause();item.el.removeAttribute('src');item.el.load();}delete media[id];}
  function loadMedia(card,info){
    releaseMedia(card.id);if(!info.url && !info.path)return;if(info.objectURL)ownedURLs[info.url]=true;
    var video=(info.type || card.mediaType)==='video',el=document.createElement(video?'video':'img');
    var item={el:el,url:info.url || mediaURL(info.path),path:info.path || '',objectURL:!!info.objectURL,ready:false,autoHighlight:!!info.autoHighlight};media[card.id]=item;
    el.addEventListener(video?'loadeddata':'load',function(){if(media[card.id]!==item)return;item.ready=true;autoFitHighlight(card,item);draw();renderThumbnails();});
    el.addEventListener('error',function(){if(media[card.id]!==item)return;item.failed=true;status('素材が見つからないか、プレビューできない形式です。素材を選び直してください。',true);});
    if(video){el.muted=true;el.preload='auto';el.playsInline=true;el.addEventListener('seeked',function(){item.seekVersion=(item.seekVersion || 0)+1;draw();});}el.src=item.url;
  }
  function autoFitHighlight(card,item){
    if(renderBusy || !isHighlight() || card!==project.cards[0] || !item || !item.ready || !item.autoHighlight)return;
    var sw=item.el.videoWidth || item.el.naturalWidth,sh=item.el.videoHeight || item.el.naturalHeight;if(!sw || !sh)return;
    var factor=Math.min(project.width*.8/sw,project.height*.8/sh),h=project.highlight;
    h.width=Math.max(16,Math.round(sw*factor));h.height=Math.max(16,Math.round(sh*factor));
    card.mediaScale=100;card.mediaX=0;card.mediaY=0;item.autoHighlight=false;edited('media:'+card.id+':'+item.url,30000);
    syncHighlightControls();syncMediaControls();requestHighlightDraw(false);
    status('素材のサイズに合わせました。');
  }
  function synchronizeMedia(){Object.keys(media).forEach(function(id){if(!cardByID(id))releaseMedia(id);else if((isHighlight()?project.cards.indexOf(cardByID(id))>0:(isSplit() && project.cards.indexOf(cardByID(id))>2)) && media[id].el.tagName==='VIDEO')media[id].el.pause();});activeCards().forEach(function(c){if(c.mediaPath && (!media[c.id] || media[c.id].path!==c.mediaPath))loadMedia(c,{path:c.mediaPath,type:c.mediaType});});}
  function selectCard(id){if(renderBusy)return;selected=id;renderCards();renderEditor();draw();}
  function applyMedia(card,info){if(renderBusy || !info || cardByID(card.id)!==card)return;card.mediaPath=info.path || '';card.mediaType=info.type || 'image';card.name=(info.name || (info.path || '').split(/[\\/]/).pop() || card.name).slice(0,100);info.autoHighlight=true;loadMedia(card,info);edited('media:'+card.id+':'+media[card.id].url,30000);renderCards();renderEditor();draw();status('「'+card.name+'」を設定しました。');}
  function pickMedia(id){if(renderBusy)return;var card=cardByID(id);if(!card)return;selectCard(id);if(Bridge.hasHost && Bridge.pickMedia)Bridge.pickMedia().then(function(info){applyMedia(card,info);}).catch(function(e){reportError(e,'素材を選べませんでした。もう一度お試しください。');});else{pendingCard=id;$('media-input').value='';$('media-input').click();}}
  window.CardMediaDrop.bind($('cards-list'), {
    available: function () { return !renderBusy && $('editor-dialog').open && !document.querySelector('dialog[open]:not(#editor-dialog)'); },
    target: function (element) { return element.closest('[data-select]'); },
    receive: function (files, row) {
      var card = cardByID(row.dataset.select);
      selected = card.id;
      applyMedia(card, files[0]);
    },
    error: function (error) { status(error.message, true); }
  });
  $('media-input').addEventListener('change',function(e){var f=e.target.files[0],card=cardByID(pendingCard);if(!f || !card)return;applyMedia(card,{path:f.path || '',name:f.name,type:f.type.indexOf('video/')===0?'video':'image',url:URL.createObjectURL(f),objectURL:true});});
  function field(card,key,label,step,min){return '<label>'+label+'<input type="number" data-card="'+text(card.id)+'" data-field="'+key+'" aria-label="'+text(card.name)+' '+label+'" step="'+step+'"'+(min!==undefined?' min="'+min+'"':'')+' value="'+Number(card[key].toFixed(4))+'"></label>';}
  function renderThumbnails(){document.querySelectorAll('[data-thumb]').forEach(function(thumb){var card=cardByID(thumb.dataset.thumb),item=media[thumb.dataset.thumb];thumb.style.backgroundColor=palette[project.cards.indexOf(card)%palette.length];if(item && card.mediaType!=='video'){var image=document.createElement('img');image.alt='';image.draggable=false;image.src=item.url;thumb.replaceChildren(image);}else thumb.textContent=item && card.mediaType==='video'?'▶':'＋';});}
  function renderCards(){
    var cards=activeCards();$('card-total').textContent=cards.length;$('card-count').value=project.cards.length;
    $('cards-list').innerHTML=cards.map(function(c,i){var assigned=!!c.mediaPath || !!media[c.id],label=isSplit()?['LEFT · 左','CENTER · 中央','RIGHT · 右'][i]:String(i+1);return '<article class="card-row'+(selected===c.id?' selected':'')+'" data-select="'+text(c.id)+'" tabindex="0" aria-label="'+text(c.name)+'を編集"><button type="button" class="source-thumb" data-thumb="'+text(c.id)+'" aria-label="'+text(c.name)+'の素材を選ぶ" title="画像・動画をドロップ、またはクリックして選択"></button><div class="card-info"><div class="card-title"><span class="card-order">'+label+'</span><span class="card-name" title="'+text(c.name)+'">'+text(c.name)+'</span></div><span class="source-meta">'+(assigned?(c.mediaType==='video'?'動画':'画像'):'＋に画像・動画をドロップ')+(isSplit() || isHighlight()?'':' · '+Number(c.flipAt.toFixed(2))+'秒でめくる')+'</span></div><button class="media-button" data-media="'+text(c.id)+'">'+(assigned?'素材を変更':'画像・動画を選ぶ')+'</button>'+(isSplit() || isHighlight()?'':'<div class="reorder"><button data-move="'+i+'" data-direction="-1" aria-label="めくる順番を前に"'+(i===0?' disabled':'')+'>↑</button><button data-move="'+i+'" data-direction="1" aria-label="めくる順番を後に"'+(i===cards.length-1?' disabled':'')+'>↓</button></div>')+'</article>';}).join('');
    renderThumbnails();var missing=cards.filter(function(c){return !c.mediaPath && !media[c.id];}).length;$('missing-media-warning').hidden=!missing;$('missing-media-warning').textContent='素材が未設定の'+(isHighlight()?'画像':(isSplit()?'パネル':'カード'))+'が'+missing+'枚あります。このまま作成すると、'+(isSplit() || isHighlight()?'その部分':'表面')+'は単色になります。';
  }
  function renderEditor(){
    var c=cardByID(selected);if(!c)return;var i=project.cards.indexOf(c);
    $('selected-name').textContent=(isHighlight()?'強調する素材':(isSplit()?['左のパネル','中央のパネル','右のパネル'][i]:(i+1)+'.'))+' '+c.name;
    $('selected-fields').innerHTML=isHighlight()?'<p class="field-help">画像・動画全体の外周だけに、色と光の枠を重ねます。</p>':(isSplit()?'<p class="field-help">左 → 中央 → 右の順に降りてきます。登場の速さと間隔は右の設定で調整できます。</p>':'<div class="field-grid">'+field(c,'dropAt','上から登場する時刻 (秒)',.1,0)+field(c,'flipAt','めくり始める時刻 (秒)',.1,0)+'</div><p class="field-help">演出が始まってからの秒数です。プレビューの再生バーで時刻を確認できます。</p>');
    $('selected-details').innerHTML=(isSplit() || isHighlight()?'':field(c,'x','カード全体の横の位置 (px)',1)+field(c,'y','カード全体の縦の位置 (px)',1))+field(c,'mediaOffset','動画の再生開始位置 (秒)',.1,0);
    document.querySelector('#card-details summary').textContent=isSplit() || isHighlight()?'動画の再生開始位置を調整':'カード全体の位置・動画の詳細';
    syncMediaControls();
  }
  function syncMediaControls(except){
    var c=cardByID(selected);if(!c)return;
    $('media-x').min=-2*project.width;$('media-x').max=2*project.width;$('media-y').min=-2*project.height;$('media-y').max=2*project.height;
    document.querySelectorAll('[data-media-adjust]').forEach(function(input){if(input!==except)input.value=c[input.dataset.mediaAdjust];});
  }
  function adjustMedia(e){
    if(renderBusy)return;var input=e.target;if(!input.dataset.mediaAdjust)return;
    var c=cardByID(selected),key=input.dataset.mediaAdjust;
    if(input.value===''){if(e.type==='change')input.value=c[key];return;}
    var value=Number(input.value);if(!Number.isFinite(value))return;
    if(input.hasAttribute('min'))value=Math.max(Number(input.min),value);if(input.hasAttribute('max'))value=Math.min(Number(input.max),value);
    c[key]=value;edited();syncMediaControls(e.type==='input'?input:null);draw();
  }
  document.querySelector('.media-adjust').addEventListener('input',adjustMedia);
  document.querySelector('.media-adjust').addEventListener('change',adjustMedia);
  $('reset-media').addEventListener('click',function(){if(renderBusy)return;var c=cardByID(selected);c.mediaScale=100;c.mediaX=0;c.mediaY=0;edited();syncMediaControls();draw();status('選んだ素材の大きさと位置を標準に戻しました。');});
  $('center-media').addEventListener('click',function(){if(renderBusy)return;var c=cardByID(selected);c.mediaX=0;c.mediaY=0;edited();syncMediaControls();draw();status('素材の大きさを保ち、位置だけ中央に戻しました。');});
  $('cards-list').addEventListener('click',function(e){if(renderBusy)return;var button=e.target.closest('button');if(button && (button.dataset.media || button.dataset.thumb)){pickMedia(button.dataset.media || button.dataset.thumb);return;}if(button && button.dataset.move!==undefined){var from=Number(button.dataset.move),to=from+Number(button.dataset.direction);try{project=Model.reorder(project,from,to) || project;}catch(e){reportError(e,'この順番では演出が長くなりすぎます。めくる時刻を少し早めてください。');return;}edited();syncSettings();status('めくる順番を変更しました。');return;}var row=e.target.closest('[data-select]');if(row)selectCard(row.dataset.select);});
  $('cards-list').addEventListener('keydown',function(e){if(renderBusy)return;if((e.key==='Enter' || e.key===' ') && e.target.matches('[data-select]')){e.preventDefault();selectCard(e.target.dataset.select);}});
  function extendDuration(){var split=splitSettings(),end=isHighlight()?project.duration:(isSplit()?split.startAt+split.interval*2+split.slideDuration:Math.max.apply(null,project.cards.map(function(c){return Math.max(c.dropAt+project.dropDuration,c.flipAt+project.flipDuration); })));project.duration=Math.min(120,Math.max(project.duration,Math.ceil(end*10)/10));}
  document.querySelector('.selected-editor').addEventListener('change',function(e){if(renderBusy)return;var input=e.target;if(!input.dataset.field)return;var c=cardByID(input.dataset.card),value=number(input.value,c[input.dataset.field]);if(input.min!=='')value=Math.max(Number(input.min),value);c[input.dataset.field]=value;if(input.dataset.field==='dropAt')c.flipAt=Math.max(c.flipAt,c.dropAt);if(input.dataset.field==='flipAt')c.flipAt=Math.max(c.flipAt,c.dropAt);edited();extendDuration();syncSettings();});
  $('card-count').addEventListener('change',function(){if(renderBusy)return;var count=Math.max(1,Math.min(12,Math.round(number(this.value,project.cards.length))));project=Model.resizeCards(project,count) || project;if(!cardByID(selected))selected=project.cards[0].id;edited();synchronizeMedia();syncSettings();status('枚数を変更しました。「横一列」「グリッド」で整列できます。');});
  function syncMode(){
    var mode=project.mode || 'cards';document.body.dataset.mode=mode;
    document.querySelectorAll('[data-mode-only]').forEach(function(el){el.hidden=el.dataset.modeOnly!==mode;});
    document.querySelectorAll('[data-mode-value]').forEach(function(button){var active=button.dataset.modeValue===mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    $('selected-label').textContent=isHighlight()?'強調する素材':(isSplit()?'選択中のパネル':'選択中のカード');
    document.querySelector('#advanced-settings summary').textContent=isSplit() || isHighlight()?'画面サイズ・フレームレート':'画面サイズ・カードの見た目';
    $('export-background-help').textContent=project.backgroundMode==='solid'?'背景色を付けて、そのまま使える動画にします。':'背景が透明なので、映像の上に重ねられます。';
    $('preview-keyboard-help').textContent=isHighlight()?'ドラッグで画像と枠を移動 · 矢印1px／Shift＋矢印10px · Space再生（頂点編集時は選んだ頂点を移動）':(isSplit()?'クリックで面を選択 · 矢印で素材を1px移動／Shiftで10px · Space再生':'クリックで選択・ドラッグで配置 · 矢印1px／Shift＋矢印10px · Space再生');
    $('mode-note').textContent=isHighlight()?'画像の外周に、色と光を重ねる':(isSplit()?'3つの素材を、左から順に上からスライド':'枚数・場所・めくる順番を自由に');
    $('welcome-title').textContent=isHighlight()?'見せたい画像を、光る外周で囲む。':(isSplit()?'3つの画面で、一度に見せる。':'上から登場。めくった先に、主役。');
    $('welcome-copy').textContent=isHighlight()?'画像・動画を選んで、枠の形・色・光の重なりを調整できます。':(isSplit()?'斜めの境界で画面を3分割。左・中央・右の素材を選ぶだけ。':'画像・動画を選んで、並べて、好きな時刻にめくりましょう。');
    $('guide-step-two').textContent=isHighlight()?'外周の形と光を整える':(isSplit()?'傾きと登場の速さを決める':'並べて、めくる時刻を決める');
    $('preview-title').textContent=isHighlight()?'画像の外周だけを強調':(isSplit()?'左から順に、上から登場':'配置とめくるタイミング');
    $('source-heading').textContent=isHighlight()?'強調する素材':(isSplit()?'左・中央・右の素材':'素材・順番');
    $('source-description').textContent=isHighlight()?'素材は1つ。別モードの設定も保持します。':(isSplit()?'左・中央・右に画像や動画を設定。':'選択して編集。↑ ↓ で順番を変更。');
    $('background-mode').value=project.backgroundMode || 'transparent';$('background-color-field').hidden=project.backgroundMode!=='solid';$('background-badge').textContent=project.backgroundMode==='solid'?'背景に色を付けています':'背景は透明です';
    document.querySelectorAll('[data-split-setting]').forEach(function(input){input.value=splitSettings()[input.dataset.splitSetting];});
    if(isHighlight()){syncHighlightControls();autoFitHighlight(project.cards[0],media[project.cards[0].id]);}
  }
  function syncSettings(){
    syncMode();document.querySelectorAll('[data-setting]').forEach(function(input){var value=project[input.dataset.setting];if(input.dataset.setting==='fps' && !Array.from(input.options).some(function(o){return Number(o.value)===value;})){var option=document.createElement('option');option.value=value;option.textContent=value+' fps';input.appendChild(option);}input.value=value;});
    $('output-preset').value=project.width===1920 && project.height===1080?'landscape':(project.width===1080 && project.height===1920?'portrait':'custom');$('scrub').max=project.duration;currentTime=Math.min(currentTime,project.duration);$('scrub').value=currentTime;$('total-time').textContent=Number(project.duration).toFixed(2);$('canvas-size').textContent=project.width+' × '+project.height;canvas.width=Math.min(1600,project.width);canvas.height=Math.round(canvas.width*project.height/project.width);renderCards();renderEditor();fitPreview();draw();
  }
  document.querySelectorAll('[data-setting]').forEach(function(input){input.addEventListener('change',function(){if(renderBusy)return;var key=input.dataset.setting;if(input.type==='color')project[key]=input.value;else{var value=number(input.value,project[key]);if(input.hasAttribute('min'))value=Math.max(Number(input.min),value);if(input.hasAttribute('max'))value=Math.min(Number(input.max),value);if(['width','height','fps','cardWidth','cardHeight'].indexOf(key)>=0)value=Math.round(value);if(key==='width' || key==='height')value=Math.round(value/2)*2;project[key]=value;}edited();if(key==='dropDuration' || key==='flipDuration')extendDuration();syncSettings();});});
  $('output-preset').addEventListener('change',function(){if(renderBusy)return;if(this.value==='custom'){$('advanced-settings').open=true;return;}var oldW=project.width,oldH=project.height;project.width=this.value==='portrait'?1080:1920;project.height=this.value==='portrait'?1920:1080;if(project.highlight){project.highlight.x=Math.round(project.highlight.x/oldW*project.width);project.highlight.y=Math.round(project.highlight.y/oldH*project.height);}project.cards.forEach(function(c){c.x=Math.round(c.x/oldW*project.width);c.y=Math.round(c.y/oldH*project.height);});edited();syncSettings();status('動画の向きを変更しました。カードの位置を確認してください。');});
  document.querySelectorAll('[data-layout]').forEach(function(button){button.addEventListener('click',function(){if(renderBusy)return;try{project=Model.arrange(project,button.dataset.layout,selected) || project;}catch(e){reportError(e,'この画面サイズには並べられません。画面かカードのサイズを調整してください。');return;}edited();currentTime=Math.min(project.duration,Math.max.apply(null,project.cards.map(function(c){return c.dropAt+project.dropDuration;})));setPlaying(false);syncSettings();status(button.dataset.layout==='center'?'選んだカードを画面の中央に移動しました。':'カードを並べました。ドラッグでさらに調整できます。');});});
  $('flip-now').addEventListener('click',function(){if(renderBusy)return;var c=cardByID(selected);c.flipAt=Math.max(c.dropAt,currentTime);edited();extendDuration();syncSettings();status(c.flipAt>currentTime?'登場より前にはめくれないため、登場時刻に合わせました。':'選んだカードが'+currentTime.toFixed(2)+'秒からめくれるようにしました。');});
  $('sequence-cards').addEventListener('click',function(){if(renderBusy)return;var interval=Math.max(.1,Math.min(10,number($('sequence-interval').value,.8)));$('sequence-interval').value=interval;try{project=Model.sequence(project,currentTime,interval) || project;edited();syncSettings();status('現在の位置から、'+interval+'秒間隔でめくるようにしました。');}catch(e){reportError(e,'この時刻からは設定できません。再生位置か間隔を短くしてください。');}});
  function coverImage(el,x,y,w,h,card){var sw=el.videoWidth || el.naturalWidth,sh=el.videoHeight || el.naturalHeight;if(!sw || !sh)return;var rect=Model.mediaRect(card,sw,sh,w,h);ctx.drawImage(el,x+rect.x,y+rect.y,rect.width,rect.height);}
  function drawBack(w,h){ctx.fillStyle=project.backColor;ctx.fillRect(-w/2,-h/2,w,h);ctx.save();ctx.strokeStyle=project.borderColor;ctx.globalAlpha=.38;ctx.lineWidth=2;ctx.strokeRect(-w/2+w*.12,-h/2+h*.08,w*.76,h*.84);ctx.restore();}
  function manageVideo(item,pose){var video=item.el,duration=Number.isFinite(video.duration)?video.duration:0,target=Math.max(0,Math.min(pose.mediaTime || 0,Math.max(0,duration-.04)));if(!video.seeking && Math.abs(video.currentTime-target)>(playing?.2:.02)){try{video.currentTime=target;}catch(ignore){}}if(playing && pose.visible && pose.front && target<duration-.05){if(video.paused)video.play().catch(function(){});}else if(!video.paused)video.pause();}
  function selectedLayerValue(){return project.highlight.layers.find(function(layer){return layer.id===selectedLayer;});}
  function renderLayers(except){
    if(!isHighlight())return;var layers=project.highlight.layers;
    if(!selectedLayerValue())selectedLayer=layers.length?layers[layers.length-1].id:null;
    $('layer-list').innerHTML=layers.length?layers.map(function(layer,i){return '<div class="layer-row'+(layer.id===selectedLayer?' selected':'')+'" data-layer-select="'+text(layer.id)+'" tabindex="0"><input type="checkbox" data-layer-enabled="'+text(layer.id)+'" aria-label="'+text(layer.name)+'を表示"'+(layer.enabled?' checked':'')+'><span class="layer-swatch" data-layer-swatch="'+i+'"></span><span class="layer-name">'+text(layer.name)+'</span><button data-layer-move="'+i+'" data-direction="-1" title="ひとつ奥へ" aria-label="'+text(layer.name)+'を奥へ"'+(i===0?' disabled':'')+'>↑</button><button data-layer-move="'+i+'" data-direction="1" title="ひとつ手前へ" aria-label="'+text(layer.name)+'を手前へ"'+(i===layers.length-1?' disabled':'')+'>↓</button><button data-layer-delete="'+i+'" title="枠を削除" aria-label="'+text(layer.name)+'を削除">×</button></div>';}).join(''):'<p class="empty-layers">枠はありません。「枠を追加」で重ねられます。</p>';
    document.querySelectorAll('[data-layer-swatch]').forEach(function(el){el.style.backgroundColor=layers[Number(el.dataset.layerSwatch)].color;});
    var layer=selectedLayerValue();document.querySelectorAll('[data-layer-setting]').forEach(function(input){input.disabled=renderBusy || !layer;if(input===except)return;var key=input.dataset.layerSetting;input.value=layer?(key==='opacity'?Math.round(layer[key]*100):layer[key]):(input.type==='color'?'#ffffff':'');});$('add-layer').disabled=renderBusy || layers.length>=12;
  }
  function syncPointControls(){
    if(!isHighlight())return;var h=project.highlight;selectedPoint=Math.max(0,Math.min(selectedPoint,h.points.length-1));
    $('selected-point').innerHTML=h.points.map(function(p,i){return '<option value="'+i+'">頂点 '+(i+1)+'</option>';}).join('');$('selected-point').value=selectedPoint;
    $('point-x').value=Number((h.points[selectedPoint].x*100).toFixed(2));$('point-y').value=Number((h.points[selectedPoint].y*100).toFixed(2));
    $('remove-point').disabled=renderBusy || h.points.length<=3;$('add-point').disabled=renderBusy || h.points.length>=12;
  }
  function syncHighlightControls(except,positionOnly){
    if(!isHighlight())return;var h=project.highlight;
    document.querySelectorAll('[data-highlight-setting]').forEach(function(input){var key=input.dataset.highlightSetting;if(key==='x'){input.min=-2*project.width;input.max=2*project.width;}if(key==='y'){input.min=-2*project.height;input.max=2*project.height;}if(input!==except){if(input.type==='checkbox')input.checked=h[key]!==false;else input.value=h[key];}});
    if(positionOnly)return;
    $('highlight-radius-label').hidden=h.shape!=='rounded';$('edit-polygon').hidden=h.shape!=='polygon';$('edit-polygon').setAttribute('aria-pressed',String(polygonEditing));$('edit-polygon').textContent=polygonEditing?'頂点の編集を終える':'頂点を編集';$('add-point').hidden=h.shape!=='polygon' || !polygonEditing;$('remove-point').hidden=h.shape!=='polygon' || !polygonEditing;$('point-controls').hidden=h.shape!=='polygon';
    $('polygon-hint').textContent=h.shape==='polygon'?(polygonEditing?'白い点をドラッグして形を調整。線が交差する位置には動かせません。':'「頂点を編集」で角を動かせます。画像と枠の移動はプレビューをドラッグ。'):'';
    syncPointControls();renderLayers();
  }
  function requestHighlightDraw(defer){
    clearTimeout(highlightTimer);highlightPending=!!defer;
    if(defer)highlightTimer=setTimeout(function(){highlightPending=false;draw();},55);
    draw();
  }
  function frameChanged(e){
    if(renderBusy || !isHighlight())return;var input=e.target,key=input.dataset.highlightSetting;if(!key)return;var h=project.highlight,value=input.type==='checkbox'?input.checked:input.value;
    if(input.type==='number'){if(value===''){if(e.type==='change')input.value=h[key];return;}value=Number(value);if(!Number.isFinite(value))return;if(input.hasAttribute('min'))value=Math.max(Number(input.min),value);if(input.hasAttribute('max'))value=Math.min(Number(input.max),value);if(key==='width' || key==='height')value=Math.round(value);}
    if(key==='shape' && usingSourceContour())h.followAlpha=false;
    h[key]=value;if(key==='shape' || key==='followAlpha')polygonEditing=false;edited();syncHighlightControls(e.type==='input'?input:null,true);
    if(key==='shape' || key==='followAlpha')syncHighlightControls();requestHighlightDraw(e.type==='input' && ['x','y','rotation'].indexOf(key)<0);
  }
  document.querySelectorAll('[data-highlight-setting]').forEach(function(input){input.addEventListener('input',frameChanged);input.addEventListener('change',frameChanged);});
  function layerChanged(e){
    if(renderBusy || !isHighlight())return;var input=e.target,key=input.dataset.layerSetting,layer=selectedLayerValue();if(!key || !layer)return;var value=input.value;
    if(input.type==='number'){if(value===''){if(e.type==='change')input.value=key==='opacity'?layer[key]*100:layer[key];return;}value=Number(value);if(!Number.isFinite(value))return;value=Math.max(Number(input.min),Math.min(Number(input.max),value));if(key==='opacity')value/=100;}
    if(key==='name')value=value.slice(0,40);layer[key]=value;edited();renderLayers(e.type==='input'?input:null);requestHighlightDraw(e.type==='input' && key!=='name');
  }
  document.querySelectorAll('[data-layer-setting]').forEach(function(input){input.addEventListener('input',layerChanged);input.addEventListener('change',layerChanged);});
  $('layer-list').addEventListener('click',function(e){
    if(renderBusy)return;var button=e.target.closest('button'),row=e.target.closest('[data-layer-select]');
    if(button && button.dataset.layerDelete!==undefined){project.highlight.layers.splice(Number(button.dataset.layerDelete),1);edited();renderLayers();requestHighlightDraw(false);return;}
    if(button && button.dataset.layerMove!==undefined){var index=Number(button.dataset.layerMove);Model.reorderHighlightLayer(project,index,index+Number(button.dataset.direction));edited();renderLayers();requestHighlightDraw(false);return;}
    if(row){selectedLayer=row.dataset.layerSelect;if(!e.target.dataset.layerEnabled)renderLayers();}
  });
  $('layer-list').addEventListener('keydown',function(e){if(renderBusy)return;if(e.target.matches('[data-layer-select]') && (e.key==='Enter' || e.key===' ')){e.preventDefault();selectedLayer=e.target.dataset.layerSelect;renderLayers();}});
  $('layer-list').addEventListener('change',function(e){if(renderBusy || !e.target.dataset.layerEnabled)return;var layer=project.highlight.layers.find(function(layer){return layer.id===e.target.dataset.layerEnabled;});if(layer){layer.enabled=e.target.checked;edited();renderLayers();requestHighlightDraw(false);}});
  $('add-layer').addEventListener('click',function(){if(renderBusy)return;try{selectedLayer=Model.addHighlightLayer(project);edited();renderLayers();requestHighlightDraw(false);}catch(e){reportError(e,'枠は12個まで追加できます。');}});
  $('reset-layers').addEventListener('click',function(){
    if(renderBusy)return;
    project.highlight.layers=Model.defaultHighlight(project).layers;
    project.highlight.followAlpha=true;selectedLayer=null;polygonEditing=false;
    edited();syncHighlightControls();requestHighlightDraw(false);status('細い縁と薄い影を適用しました。');
  });
  $('fit-highlight').addEventListener('click',function(){
    if(renderBusy)return;var c=project.cards[0],item=media[c.id],sw=item && (item.el.videoWidth || item.el.naturalWidth),sh=item && (item.el.videoHeight || item.el.naturalHeight);if(!sw || !sh){status('先に画像・動画を選び、読み込みが終わってからお試しください。',true);return;}
    var factor=Math.min(project.width*.8/sw,project.height*.8/sh),h=project.highlight;h.width=Math.max(16,Math.min(3840,Math.round(sw*factor)));h.height=Math.max(16,Math.min(2160,Math.round(sh*factor)));edited();syncHighlightControls();requestHighlightDraw(false);status('外周の枠を素材の縦横比に合わせました。');
  });
  function changePoint(index,x,y){
    var h=project.highlight,old=h.points[index];h.points[index]={x:x,y:y};if(!Model.highlightPolygonValid(h.points)){h.points[index]=old;status('線が交差しないように頂点を動かしてください。',true);syncPointControls();return false;}edited();syncPointControls();requestHighlightDraw(true);return true;
  }
  $('edit-polygon').addEventListener('click',function(){if(renderBusy)return;if(usingSourceContour()){project.highlight.followAlpha=false;edited();}polygonEditing=!polygonEditing;syncHighlightControls();draw();});
  $('selected-point').addEventListener('change',function(){if(renderBusy)return;selectedPoint=Number(this.value);syncPointControls();draw();});
  ['point-x','point-y'].forEach(function(id){$(id).addEventListener('change',function(){if(renderBusy)return;var p=project.highlight.points[selectedPoint],v=Math.max(0,Math.min(100,number(this.value,0)))/100;changePoint(selectedPoint,id==='point-x'?v:p.x,id==='point-y'?v:p.y);});});
  $('add-point').addEventListener('click',function(){if(renderBusy)return;try{selectedPoint=Model.addHighlightPoint(project.highlight,selectedPoint);edited();syncHighlightControls();requestHighlightDraw(false);}catch(e){reportError(e,'頂点は12個まで追加できます。');}});
  $('remove-point').addEventListener('click',function(){if(renderBusy)return;try{Model.removeHighlightPoint(project.highlight,selectedPoint);selectedPoint=Math.min(selectedPoint,project.highlight.points.length-1);edited();syncHighlightControls();requestHighlightDraw(false);}catch(e){reportError(e,'頂点は3個以上必要です。');}});
  function getPreviewAlpha(item,card,rect,scale){
    var el=item.el,video=el.tagName==='VIDEO';
    var w=el.videoWidth || el.naturalWidth,h=el.videoHeight || el.naturalHeight;
    var size=window.CardHighlight.sampleSize(w,h,rect,scale,1000000);
    var time=video?el.currentTime:0;
    var placementKey=[rect.x,rect.y,rect.width,rect.height,project.highlight.width,project.highlight.height,canvas.width/project.width].join('/');
    var key=[size.width,size.height,Math.floor(time*project.fps),item.seekVersion || 0].join('/');
    if(item.alphaBlocked && video)key+=':'+placementKey;
    if(item.alphaSample && (item.alphaSample.key===key || (video && el.seeking)))return item.alphaSample;
    function sample(alpha){
      var previous=item.alphaSample;
      if(video && alpha && previous && previous.alpha && previous.width===size.width && previous.height===size.height){
        var i=0;while(i<alpha.length && alpha[i]===previous.alpha[i])i++;
        if(i===alpha.length)alpha=previous.alpha;
      }
      return {key:key,alpha:alpha,width:size.width,height:size.height};
    }
    if(!item.alphaBlocked){
      try{
        var surface=item.alphaCanvas || (item.alphaCanvas=document.createElement('canvas'));
        if(surface.width!==size.width)surface.width=size.width;
        if(surface.height!==size.height)surface.height=size.height;
        var context=surface.getContext('2d',{willReadFrequently:true});
        context.clearRect(0,0,size.width,size.height);context.drawImage(el,0,0,size.width,size.height);
        item.alphaSample=sample(window.CardHighlight.alphaPlane(context.getImageData(0,0,size.width,size.height).data));
        return item.alphaSample;
      }catch(error){
        if(error.name!=='SecurityError')throw error;
        item.alphaCanvas=null;item.alphaBlocked=true;
      }
    }
    // File URLs in some CEP builds can be displayed but do not allow canvas pixel reads.
    if(!item.alphaController && !item.alphaFailed && Bridge.previewAlpha && item.path){
      var controller=new AbortController(),captured;item.alphaController=controller;
      if(video){
        // Keep the visible video and its asynchronously decoded matte on the same frame.
        key=[size.width,size.height,Math.floor(time*project.fps),item.seekVersion || 0].join('/')+':'+placementKey;
        var frame=project.highlight,displayScale=canvas.width/project.width;
        captured=document.createElement('canvas');captured.width=Math.max(1,Math.round(frame.width*displayScale));captured.height=Math.max(1,Math.round(frame.height*displayScale));
        var paint=captured.getContext('2d');paint.scale(captured.width/frame.width,captured.height/frame.height);
        paint.drawImage(el,rect.x,rect.y,rect.width,rect.height);
      }
      Bridge.previewAlpha(item.path,size,time,controller.signal).then(function(plane){
        if(media[card.id]!==item || controller.signal.aborted)return;
        item.alphaSample=sample(plane.some(function(a){return a!==255;})?plane:null);
        if(captured){item.alphaSample.frame=captured;item.alphaSample.placement=placementKey;}
      }).catch(function(){
        if(media[card.id]===item && !controller.signal.aborted){
          item.alphaFailed=true;status('プレビューで透明度を読み取れませんでした。書き出し時は元の素材から輪郭を計算します。',true);
        }
      }).finally(function(){item.alphaController=null;if(media[card.id]===item && !controller.signal.aborted)draw();});
    }
    return item.alphaSample && (!item.alphaSample.frame || item.alphaSample.placement===placementKey)?item.alphaSample:null;
  }
  function traceHighlightFrame(h,sourceContour){
    if(sourceContour){ctx.beginPath();ctx.rect(0,0,h.width,h.height);ctx.closePath();}
    else window.CardHighlight.trace(ctx,h);
  }
  function usingSourceContour(){
    var item=media[project.cards[0].id];
    return project.highlight.followAlpha!==false && item && item.alphaSample && item.alphaSample.alpha;
  }
  function highlightBitmap(raster){
    var bitmap=document.createElement('canvas');bitmap.width=raster.width;bitmap.height=raster.height;
    var paint=bitmap.getContext('2d'),data=paint.createImageData(raster.width,raster.height);
    data.data.set(raster.pixels);paint.putImageData(data,0,0);return bitmap;
  }
  function drawHighlight(){
    var h=project.highlight,c=project.cards[0],item=media[c.id],scale=Math.min(1,canvas.width/project.width,1000/h.width,1000/h.height);
    if(item && item.el.tagName==='VIDEO')manageVideo(item,{visible:true,front:true,mediaTime:c.mediaOffset+currentTime});
    var inspect=item && item.ready && h.followAlpha!==false;
    var rect,sample;
    if(inspect){
      rect=Model.mediaRect(c,item.el.videoWidth || item.el.naturalWidth,item.el.videoHeight || item.el.naturalHeight,h.width,h.height);
      sample=getPreviewAlpha(item,c,rect,scale);
    }
    var alpha=sample && sample.alpha;
    var cacheKey=JSON.stringify([h.width,h.height,h.shape,h.radius,h.points,h.layers,scale,alpha?rect:null]);
    if((!inspect || sample) && !highlightPending && (!highlightCache || highlightCache.key!==cacheKey || highlightCache.alpha!==alpha)){
      var source=alpha?{alpha:alpha,width:sample.width,height:sample.height,rect:rect}:null;
      var raster=window.CardHighlight.raster(h,scale,source);
      highlightCache={key:cacheKey,alpha:alpha,bitmap:highlightBitmap(raster),padding:raster.padding,scale:scale,width:h.width,height:h.height};
    }
    ctx.save();ctx.translate(h.x,h.y);ctx.rotate(h.rotation*Math.PI/180);ctx.save();ctx.translate(-h.width/2,-h.height/2);traceHighlightFrame(h,alpha);ctx.clip();if(sample && sample.frame)ctx.drawImage(sample.frame,0,0,h.width,h.height);else if(item && item.ready)coverImage(item.el,0,0,h.width,h.height,c);else{ctx.fillStyle=palette[0];ctx.fillRect(0,0,h.width,h.height);}ctx.restore();
    if((!inspect || sample) && highlightCache && highlightCache.width===h.width && highlightCache.height===h.height){var cache=highlightCache;ctx.drawImage(cache.bitmap,-h.width/2-cache.padding/cache.scale,-h.height/2-cache.padding/cache.scale,cache.bitmap.width/cache.scale,cache.bitmap.height/cache.scale);}
    if(polygonEditing && h.shape==='polygon' && !renderBusy){ctx.save();ctx.translate(-h.width/2,-h.height/2);ctx.lineWidth=1/scale;ctx.strokeStyle='#ddd1f5';window.CardHighlight.trace(ctx,h);ctx.stroke();h.points.forEach(function(p,i){ctx.beginPath();ctx.arc(p.x*h.width,p.y*h.height,(i===selectedPoint?6:4.5)/scale,0,Math.PI*2);ctx.fillStyle=i===selectedPoint?'#c19bff':'#ffffff';ctx.fill();ctx.strokeStyle='#49315f';ctx.stroke();});ctx.restore();}
    ctx.restore();
  }
  function drawSplit(){
    var polygons=Model.splitPolygons(project),settings=splitSettings(),left=polygons[0],right=polygons[2];
    activeCards().forEach(function(c,i){var pose=Model.splitPose(project,i,currentTime),item=media[c.id],polygon=polygons[i];if(item && item.el.tagName==='VIDEO')manageVideo(item,{visible:pose.visible,front:true,mediaTime:pose.mediaTime});if(!pose.visible)return;
      var xs=polygon.map(function(p){return p.x;}),ys=polygon.map(function(p){return p.y;}),x=Math.floor(Math.min.apply(null,xs)),y=Math.floor(Math.min.apply(null,ys)),w=Math.ceil(Math.max.apply(null,xs))-x,h=Math.ceil(Math.max.apply(null,ys))-y;
      ctx.save();ctx.translate(0,pose.offsetY);ctx.beginPath();polygon.forEach(function(p,j){if(j)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();ctx.clip();if(item && item.ready)coverImage(item.el,x,y,w,h,c);else{ctx.fillStyle=palette[i%palette.length];ctx.fillRect(x,y,w,h);}
      if(settings.borderWidth>0){ctx.strokeStyle=settings.borderColor;ctx.lineWidth=settings.borderWidth;ctx.beginPath();ctx.moveTo(left[1].x,left[1].y);ctx.lineTo(left[2].x,left[2].y);ctx.moveTo(right[0].x,right[0].y);ctx.lineTo(right[3].x,right[3].y);ctx.stroke();}
      ctx.restore();
    });
  }
  function draw(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);var scale=canvas.width/project.width;ctx.scale(scale,scale);if(project.backgroundMode==='solid'){ctx.fillStyle=project.backgroundColor || '#10131c';ctx.fillRect(0,0,project.width,project.height);}if(isHighlight()){drawHighlight();$('current-time').textContent=currentTime.toFixed(2);$('scrub').value=currentTime;return;}if(isSplit()){drawSplit();$('current-time').textContent=currentTime.toFixed(2);$('scrub').value=currentTime;return;}project.cards.forEach(function(c,i){var pose=Model.pose(project,c,currentTime),item=media[c.id];if(item && item.el.tagName==='VIDEO')manageVideo(item,pose);if(!pose.visible)return;var w=project.cardWidth,h=project.cardHeight,squeeze=Math.max(.003,Math.abs(pose.scaleX));ctx.save();ctx.translate(pose.x,pose.y);ctx.scale(squeeze,1);ctx.fillStyle=project.backColor;ctx.fillRect(-w/2,-h/2,w,h);ctx.save();ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);ctx.clip();if(pose.front){if(item && item.ready)coverImage(item.el,-w/2,-h/2,w,h,c);else{ctx.fillStyle=palette[i%palette.length];ctx.fillRect(-w/2,-h/2,w,h);}}else drawBack(w,h);ctx.restore();ctx.strokeStyle=project.borderColor;ctx.lineWidth=3;ctx.strokeRect(-w/2+1.5,-h/2+1.5,w-3,h-3);ctx.restore();if(c.id===selected && !playing && !renderBusy){ctx.save();ctx.translate(pose.x,pose.y);ctx.strokeStyle='#d5bcff';ctx.lineWidth=1.4/scale;ctx.setLineDash([5/scale,4/scale]);ctx.strokeRect(-w*squeeze/2-7/scale,-h/2-7/scale,w*squeeze+14/scale,h+14/scale);ctx.restore();}});$('current-time').textContent=currentTime.toFixed(2);$('scrub').value=currentTime;}
  function setPlaying(value){
    if(playing===value)return;
    playing=value;lastTick=0;
    $('play').textContent=value?'Ⅱ':'▶';$('play').setAttribute('aria-label',value?'一時停止':'再生');
    if(value){
      playbackFrame=requestAnimationFrame(tick);
    }else{
      if(playbackFrame!==null)cancelAnimationFrame(playbackFrame);
      playbackFrame=null;
      Object.keys(media).forEach(function(id){if(media[id].el.tagName==='VIDEO')media[id].el.pause();});
    }
    draw();
  }
  function tick(timestamp){
    playbackFrame=null;
    if(lastTick)currentTime=Math.min(project.duration,currentTime+(timestamp-lastTick)/1000);
    lastTick=timestamp;
    if(currentTime>=project.duration){setPlaying(false);return;}
    draw();
    playbackFrame=requestAnimationFrame(tick);
  }
  $('play').addEventListener('click',function(){if(!playing && currentTime>=project.duration)currentTime=0;setPlaying(!playing);});$('restart').addEventListener('click',function(){setPlaying(false);currentTime=0;draw();});$('scrub').addEventListener('input',function(){var target=Number(this.value);setPlaying(false);currentTime=target;draw();});
  function pointerPosition(e){var r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*project.width,y:(e.clientY-r.top)/r.height*project.height};}
  function highlightLocal(p){var h=project.highlight,r=-h.rotation*Math.PI/180,dx=p.x-h.x,dy=p.y-h.y;return{x:dx*Math.cos(r)-dy*Math.sin(r)+h.width/2,y:dx*Math.sin(r)+dy*Math.cos(r)+h.height/2};}
  canvas.addEventListener('pointerdown',function(e){
    if(renderBusy || e.button!==0)return;canvas.focus({preventScroll:true});flushHistory();var p=pointerPosition(e);
    if(isHighlight()){
      var h=project.highlight,local=highlightLocal(p),threshold=16*project.width/canvas.getBoundingClientRect().width;
      if(polygonEditing && h.shape==='polygon'){
        var closest=-1,distance=threshold;h.points.forEach(function(point,i){var d=Math.hypot(local.x-point.x*h.width,local.y-point.y*h.height);if(d<distance){distance=d;closest=i;}});
        if(closest<0){status('枠の白い頂点をドラッグしてください。');return;}selectedPoint=closest;drag={kind:'vertex',index:closest};syncPointControls();
      }else{
        ctx.save();ctx.setTransform(1,0,0,1,0,0);traceHighlightFrame(h,usingSourceContour());var hit=ctx.isPointInPath(local.x,local.y);ctx.restore();if(!hit)return;drag={kind:'highlight',x:p.x,y:p.y,hx:h.x,hy:h.y};
      }
      setPlaying(false);e.preventDefault();canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');syncHistory();draw();return;
    }
    if(isSplit()){var polygons=Model.splitPolygons(project);for(var panel=2;panel>=0;panel--){var pose=Model.splitPose(project,panel,currentTime);if(!pose.visible)continue;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();polygons[panel].forEach(function(point,j){if(j)ctx.lineTo(point.x,point.y+pose.offsetY);else ctx.moveTo(point.x,point.y+pose.offsetY);});ctx.closePath();var hit=ctx.isPointInPath(p.x,p.y);ctx.restore();if(hit){setPlaying(false);selectCard(project.cards[panel].id);return;}}return;}
    for(var i=project.cards.length-1;i>=0;i--){var c=project.cards[i],pose=Model.pose(project,c,currentTime);if(pose.visible && Math.abs(p.x-pose.x)<project.cardWidth*Math.max(.04,Math.abs(pose.scaleX))/2 && Math.abs(p.y-pose.y)<project.cardHeight/2){setPlaying(false);selected=c.id;drag={id:c.id,x:p.x,y:p.y,cx:c.x,cy:c.y};e.preventDefault();canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');syncHistory();renderCards();renderEditor();draw();return;}}
  });
  canvas.addEventListener('pointermove',function(e){
    if(!drag || renderBusy)return;var p=pointerPosition(e),dx=p.x-drag.x,dy=p.y-drag.y;if(e.shiftKey && drag.kind!=='vertex'){drag.axis=drag.axis || (Math.abs(dx)>=Math.abs(dy)?'x':'y');if(drag.axis==='x')dy=0;else dx=0;}
    if(drag.kind==='highlight'){var h=project.highlight;h.x=Math.max(-2*project.width,Math.min(2*project.width,Math.round(drag.hx+dx)));h.y=Math.max(-2*project.height,Math.min(2*project.height,Math.round(drag.hy+dy)));edited();syncHighlightControls(null,true);draw();return;}
    if(drag.kind==='vertex'){var local=highlightLocal(p),h=project.highlight;drag.invalid=!changePoint(drag.index,Math.max(0,Math.min(1,local.x/h.width)),Math.max(0,Math.min(1,local.y/h.height)));return;}
    var c=cardByID(drag.id);c.x=Math.max(-2*project.width,Math.min(2*project.width,Math.round(drag.cx+dx)));c.y=Math.max(-2*project.height,Math.min(2*project.height,Math.round(drag.cy+dy)));edited();var x=document.querySelector('[data-field="x"]'),y=document.querySelector('[data-field="y"]');if(x)x.value=c.x;if(y)y.value=c.y;draw();
  });
  function finishDrag(){if(drag){var kind=drag.kind,invalid=drag.invalid;drag=null;edited(null);canvas.classList.remove('dragging');highlightPending=false;clearTimeout(highlightTimer);draw();status(invalid?'線が交差するため、最後に有効だった位置を保ちました。':(kind==='vertex'?'頂点の形を変更しました。':(kind==='highlight'?'画像と枠を移動しました。':'カードを移動しました。')),invalid);}}
  canvas.addEventListener('pointerup',finishDrag);canvas.addEventListener('pointercancel',finishDrag);
  canvas.addEventListener('keydown',function(event){if(renderBusy || drag || event.ctrlKey || event.metaKey || event.altKey)return;var step=event.shiftKey?10:1,dx=0,dy=0;if(event.key==='ArrowLeft')dx=-step;else if(event.key==='ArrowRight')dx=step;else if(event.key==='ArrowUp')dy=-step;else if(event.key==='ArrowDown')dy=step;else return;event.preventDefault();setPlaying(false);
    var c=cardByID(selected),h=project.highlight;
    if(isHighlight() && polygonEditing && h.shape==='polygon'){var p=h.points[selectedPoint];if(!changePoint(selectedPoint,Math.max(0,Math.min(1,p.x+dx/h.width)),Math.max(0,Math.min(1,p.y+dy/h.height))))return;}
    else if(isHighlight()){h.x=Math.max(-2*project.width,Math.min(2*project.width,h.x+dx));h.y=Math.max(-2*project.height,Math.min(2*project.height,h.y+dy));syncHighlightControls();}
    else if(isSplit()){c.mediaX=Math.max(-2*project.width,Math.min(2*project.width,c.mediaX+dx));c.mediaY=Math.max(-2*project.height,Math.min(2*project.height,c.mediaY+dy));syncMediaControls();}
    else{c.x=Math.max(-2*project.width,Math.min(2*project.width,c.x+dx));c.y=Math.max(-2*project.height,Math.min(2*project.height,c.y+dy));renderEditor();}
    edited('nudge:'+selected+':'+(polygonEditing?selectedPoint:'frame'));draw();
  });

  function replaceProject(next){if(renderBusy || !next)return;next=Model.upgrade(next);var errors=Model.validate(next);if(errors.length)throw new Error(errors.join(' / '));setPlaying(false);Object.keys(media).forEach(releaseMedia);project=next;selected=next.cards[0].id;selectedLayer=null;selectedPoint=0;polygonEditing=false;highlightPending=false;clearTimeout(highlightTimer);currentTime=isHighlight()?0:Math.min(project.duration,isSplit()?splitSettings().startAt+splitSettings().interval*2+splitSettings().slideDuration:Math.max.apply(null,project.cards.map(function(c){return c.dropAt+project.dropDuration;})));dirty=false;synchronizeMedia();syncSettings();resetHistory();window.dispatchEvent(new CustomEvent('cardreveal:project-loaded'));status(Bridge.hasHost?'設定を開きました。素材とタイミングを確認してください。':'設定を開きました。ブラウザーで選んだ素材は、選び直してください。');}
  $('sample-project').addEventListener('click',function(){if(renderBusy)return;if(dirty && !window.confirm('現在の設定をサンプルに置き換えます。保存していない変更は失われます。よろしいですか？'))return;var sample=Bridge.sampleProject?Bridge.sampleProject():Promise.resolve((function(){var p=Model.createProject();['boss.png','treasure.png','quest.png'].forEach(function(name,i){p.cards[i].name=['ボス','宝箱','次のクエスト'][i];p.cards[i].mediaPath=new URL('examples/media/'+name,window.location.href).href;p.cards[i].mediaType='image';});return p;}()));Promise.resolve(sample).then(function(p){p=Model.setMode(p,project.mode || 'cards') || p;replaceProject(p);currentTime=0;setPlaying(true);status('サンプルを再生しています。「素材を変更」で自分の画像・動画に替えられます。');}).catch(function(e){reportError(e,'サンプルを開けませんでした。素材を選んで作成を始められます。');});});
  $('save-project').addEventListener('click',function(){if(renderBusy)return;if(Bridge.saveProject)Promise.resolve(Bridge.saveProject(project)).then(function(result){if(result!==null){dirty=false;status('設定を保存しました。');}}).catch(function(e){reportError(e,'設定を保存できませんでした。保存先を確認してください。');});else{var blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='card-reveal.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},2000);dirty=false;status('設定を保存しました。ブラウザーで選んだ素材は、開くときに選び直してください。');}});
  $('load-project').addEventListener('click',function(){if(renderBusy)return;if(Bridge.hasHost && Bridge.loadProject)Bridge.loadProject().then(replaceProject).catch(function(e){reportError(e,'設定を開けませんでした。対応するJSONファイルを選んでください。');});else{$('project-input').value='';$('project-input').click();}});$('project-input').addEventListener('change',function(e){var f=e.target.files[0];if(!f)return;var reader=new FileReader();reader.onload=function(){try{replaceProject(JSON.parse(reader.result));}catch(err){reportError(err,'設定を開けませんでした。対応するJSONファイルを選んでください。');}};reader.readAsText(f);});
  function busy(value){renderBusy=value;syncHistory();$('cancel-render').hidden=!value;$('render-progress').hidden=!value;document.querySelectorAll('input:not([type=range]),[data-media-adjust],#reset-media,#center-media,#choose-selected-media,[data-preset],[data-highlight-setting],[data-layer-setting],[data-layer-enabled],[data-layer-select],#layer-list button,#add-layer,#reset-layers,#fit-highlight,#edit-polygon,#add-point,#remove-point,#selected-point,#point-x,#point-y,select,[data-layout],[data-mode-value],#sample-project,#sequence-cards,#flip-now,#save-project,#load-project,.media-button,.reorder button,#open-output,#retry-import').forEach(function(el){el.disabled=value;});$('render').disabled=value || !Bridge.hasHost;$('compact-render-label').textContent=value?'作成中':'書き出し';$('render').firstElementChild.textContent=value?'動画を作成しています…':'動画を作成して読み込む';window.dispatchEvent(new CustomEvent('cardreveal:busy',{detail:{busy:value}}));if(!value){renderCards();syncMediaControls();if(isHighlight()){renderLayers();syncPointControls();}}}
  function showResult(result){lastOutput=result.outputPath;$('export-result').hidden=false;$('result-heading').textContent=result.imported?'Premiereに読み込みました':'動画を保存しました';$('result-message').textContent=result.imported?'プロジェクトパネルの動画を、タイムラインの上のトラックにドラッグしてください。':'動画の作成は完了しています。Premiereへの読み込みをやり直すか、保存した動画を手動で読み込めます。';$('result-path').textContent=result.outputPath || '';$('open-output').hidden=!Bridge.openOutputFolder;$('retry-import').hidden=result.imported || !Bridge.importRendered;if(result.importError){$('error-details').hidden=false;$('error-text').textContent=result.importError;}}
  $('render').addEventListener('click',function(){if(!Bridge.hasHost || renderBusy)return;var errors=Model.validate(project);if(errors.length){status(errors.join(' / '),true);return;}setPlaying(false);$('export-result').hidden=true;$('error-details').hidden=true;busy(true);$('render-progress').value=0;$('render-note').textContent='動画を作成する準備をしています…';status('保存先を選ぶと動画の作成が始まります。完了までパネルを開いておいてください。');Bridge.render(project,function(progress){var value=typeof progress==='number'?progress:(progress && progress.progress || 0);$('render-progress').value=Math.round(value*100);$('render-note').textContent='動画を作成中 '+Math.round(value*100)+'%';}).then(function(result){$('render-note').textContent=defaultRenderNote();if(!result){status('動画の作成を中止しました。設定はそのまま残っています。');return;}showResult(result);status(result.imported?'動画ができました。Premiereのプロジェクトパネルから、タイムラインへドラッグしてください。':'動画は保存できました。Premiereへの読み込みを確認してください。');}).catch(function(e){$('render-note').textContent=defaultRenderNote();if(/cancel|abort|中止/i.test(e.message || ''))status('動画の作成を中止しました。設定はそのまま残っています。');else reportError(e,'動画を作成できませんでした。素材の場所とタイミングを確認してください。');}).then(function(){busy(false);draw();});});
  $('cancel-render').addEventListener('click',function(){if(Bridge.cancelRender){Bridge.cancelRender();status('動画の作成を中止しています…');}});
  $('open-output').addEventListener('click',function(){if(lastOutput && Bridge.openOutputFolder)Promise.resolve(Bridge.openOutputFolder(lastOutput)).catch(function(e){reportError(e,'保存先を開けませんでした。上の保存場所を確認してください。');});});
  $('retry-import').addEventListener('click',function(){if(!lastOutput || !Bridge.importRendered)return;this.disabled=true;Promise.resolve(Bridge.importRendered(lastOutput)).then(function(){showResult({outputPath:lastOutput,imported:true});status('Premiereに読み込みました。タイムラインへドラッグして配置してください。');}).catch(function(e){reportError(e,'動画は保存されています。Premiereのプロジェクトを開いてから、もう一度読み込んでください。');}).then(function(){$('retry-import').disabled=false;});});
  document.querySelectorAll('[data-mode-value]').forEach(function(button){button.addEventListener('click',function(){if(renderBusy || button.dataset.modeValue===(project.mode || 'cards'))return;setPlaying(false);project=Model.setMode(project,button.dataset.modeValue) || project;if(isHighlight() || (isSplit() && project.cards.slice(0,3).every(function(c){return c.id!==selected;})))selected=project.cards[0].id;polygonEditing=false;selectedPoint=0;edited();extendDuration();synchronizeMedia();syncSettings();currentTime=isHighlight()?0:Math.min(project.duration,isSplit()?splitSettings().startAt+splitSettings().interval*2+splitSettings().slideDuration:Math.max.apply(null,project.cards.map(function(c){return c.dropAt+project.dropDuration;})));draw();status(isHighlight()?'画像の外周を強調します。枠を選んで色や光を調整できます。':(isSplit()?'台形3分割に切り替えました。左・中央・右の素材を選んでください。':'カードをめくる演出に切り替えました。'));});});
  document.querySelectorAll('[data-split-setting]').forEach(function(input){input.addEventListener('change',function(){if(renderBusy)return;var key=input.dataset.splitSetting,value=input.type==='color'?input.value:number(input.value,splitSettings()[key]);if(input.type!=='color'){if(input.hasAttribute('min'))value=Math.max(Number(input.min),value);if(input.hasAttribute('max'))value=Math.min(Number(input.max),value);}project.trapezoid[key]=value;project.trapezoid.startAt=Math.max(0,Math.min(project.trapezoid.startAt,120-project.trapezoid.interval*2-project.trapezoid.slideDuration));edited();extendDuration();syncSettings();});});
  $('background-mode').addEventListener('change',function(){if(renderBusy)return;project.backgroundMode=this.value;edited();syncSettings();});
  document.querySelectorAll('[data-mode-value]').forEach(function(button){button.addEventListener('keydown',function(event){
    if(renderBusy)return;var modes=Array.from(document.querySelectorAll('[data-mode-value]')),index=modes.indexOf(button),next;
    if(event.key==='ArrowRight')next=(index+1)%modes.length;
    else if(event.key==='ArrowLeft')next=(index+modes.length-1)%modes.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=modes.length-1;
    else return;
    event.preventDefault();modes[next].focus();modes[next].click();
  });});
  function fitPreview(){
    var stage=document.querySelector('.preview-stage'),wrap=$('preview-wrap');if(!stage || !wrap)return;
    var w=Math.max(40,stage.clientWidth-24),h=Math.max(40,stage.clientHeight-24),ratio=project.width/project.height;
    if(w/h>ratio)w=h*ratio;else h=w/ratio;
    wrap.style.width=w+'px';wrap.style.height=h+'px';
  }
  function thumbnailPath(context,points){context.beginPath();points.forEach(function(p,i){if(i)context.lineTo(p[0],p[1]);else context.moveTo(p[0],p[1]);});context.closePath();}
  function drawPresetThumbnail(target,item,snapshot){
    // Settings-only artwork works with CEP file media without reading a tainted canvas.
    var c=target.getContext('2d'),w=320,h=180;target.width=w;target.height=h;c.fillStyle='#0b0b0b';c.fillRect(0,0,w,h);
    c.strokeStyle='#181818';c.lineWidth=1;for(var g=0;g<=w;g+=20){c.beginPath();c.moveTo(g,0);c.lineTo(g,h);c.stroke();}for(var gy=0;gy<=h;gy+=20){c.beginPath();c.moveTo(0,gy);c.lineTo(w,gy);c.stroke();}
    var colors=item.colors || ['#4ea1ff','#ef9b35'],kind=item.kind;
    if(kind==='split'){
      var angle=item.angle===undefined?8:item.angle,d=Math.max(-w*.15,Math.min(w*.24,Math.tan(angle*Math.PI/180)*h)),a=w/3,b=w*2/3;
      [[[0,0],[a,0],[a-d,h],[0,h]],[[a,0],[b,0],[b+d,h],[a-d,h]],[[b,0],[w,0],[w,h],[b+d,h]]].forEach(function(points,i){c.save();thumbnailPath(c,points);c.clip();var grad=c.createLinearGradient(0,0,w,h);grad.addColorStop(0,colors[i%colors.length]);grad.addColorStop(1,'#15191e');c.fillStyle=grad;c.fillRect(0,0,w,h);c.globalAlpha=.22;c.fillStyle='#fff';c.beginPath();c.arc(70+i*95,60,50,0,Math.PI*2);c.fill();c.restore();});
      c.strokeStyle='#ffffffb3';c.lineWidth=2;c.beginPath();c.moveTo(a,0);c.lineTo(a-d,h);c.moveTo(b,0);c.lineTo(b+d,h);c.stroke();
    }else if(kind==='highlight'){
      var rw=120,rh=126;c.save();c.translate(w/2,h/2);if(snapshot && snapshot.highlight)c.rotate(snapshot.highlight.rotation*Math.PI/180);
      var p=snapshot && snapshot.highlight;function path(){if(p && p.shape==='polygon')thumbnailPath(c,p.points.map(function(point){return[(point.x-.5)*rw,(point.y-.5)*rh];}));else{c.beginPath();var radius=p && p.shape==='rectangle'?0:6;c.moveTo(-rw/2+radius,-rh/2);c.arcTo(rw/2,-rh/2,rw/2,rh/2,radius);c.arcTo(rw/2,rh/2,-rw/2,rh/2,radius);c.arcTo(-rw/2,rh/2,-rw/2,-rh/2,radius);c.arcTo(-rw/2,-rh/2,rw/2,-rh/2,radius);c.closePath();}}
      c.fillStyle='#252a30';path();c.fill();c.save();path();c.clip();c.strokeStyle='#4a515c';c.lineWidth=2;c.beginPath();c.moveTo(-75,40);c.lineTo(-22,-14);c.lineTo(5,9);c.lineTo(42,-30);c.lineTo(76,15);c.stroke();c.fillStyle='#67707c';c.beginPath();c.arc(-25,-32,11,0,Math.PI*2);c.fill();c.restore();
      p=p || Model.defaultHighlight(snapshot || {});
      var ratio=Math.min(1,rw/p.width,rh/p.height);
      var scaledLayers=p.layers.map(function(layer){return Object.assign({},layer,{width:layer.width*ratio,glow:layer.glow*ratio,offset:layer.offset*ratio});});
      var border=window.CardHighlight.raster(Object.assign({},p,{width:rw,height:rh,radius:6,layers:scaledLayers}),1);
      c.drawImage(highlightBitmap(border),-rw/2-border.padding,-rh/2-border.padding);c.restore();
    }else{
      var count=kind==='grid'?6:3,cols=kind==='grid'?3:3,rows=kind==='grid'?2:1,cw=kind==='grid'?48:58,ch=kind==='grid'?59:90;
      for(var i=0;i<count;i++){var col=i%cols,row=Math.floor(i/cols),cx=w*(col+1)/(cols+1),cy=rows===1?h/2:h*(row+.5)/rows;c.save();c.translate(cx,cy);c.shadowColor='#0008';c.shadowBlur=8;c.fillStyle=snapshot?snapshot.backColor:'#202e40';c.fillRect(-cw/2,-ch/2,cw,ch);c.shadowBlur=0;c.strokeStyle=colors[i%colors.length];c.lineWidth=2;c.strokeRect(-cw/2,-ch/2,cw,ch);c.strokeStyle='#a5b9cd66';c.lineWidth=1;c.strokeRect(-cw/2+6,-ch/2+6,cw-12,ch-12);c.fillStyle=colors[i%colors.length];c.translate(0,-3);c.rotate(Math.PI/4);c.strokeRect(-7,-7,14,14);c.restore();}
    }
  }
  $('choose-selected-media').addEventListener('click',function(){if(!renderBusy)pickMedia(selected);});
  window.addEventListener('resize',fitPreview);if(typeof ResizeObserver!=='undefined'){var previewObserver=new ResizeObserver(fitPreview);previewObserver.observe(document.querySelector('.preview-stage'));}
  
  $('render').disabled=!Bridge.hasHost;$('render-note').textContent=defaultRenderNote();syncSettings();synchronizeMedia();currentTime=Math.min(project.duration,Math.max.apply(null,project.cards.map(function(c){return c.dropAt+project.dropDuration;})));draw();historyReady=true;resetHistory();window.CardPanel={getProject:function(){return project;},setProject:replaceProject,draw:draw,getTime:function(){return currentTime;},getPlacement:function(){return window.CardLibrary.placementFrom(project,selected);},applyPlacement:function(asset){
    if(renderBusy)return;window.CardLibrary.applyPlacement(project,selected,asset);var c=cardByID(selected);loadMedia(c,{path:c.mediaPath,type:c.mediaType});edited();renderCards();renderEditor();draw();status('素材と配置の素材と大きさ・X/Yを適用しました。動きと枠の設定はそのままです。');
  },isDirty:function(){return dirty;},setDirty:function(value){dirty=!!value;},isBusy:function(){return renderBusy;},isMediaPending:function(){return activeCards().some(function(c){return media[c.id] && !media[c.id].ready && !media[c.id].failed;});},pause:function(){setPlaying(false);},fit:fitPreview,thumbnail:function(snapshot){
    var target=document.createElement('canvas');target.width=320;target.height=180;
    var context=target.getContext('2d');
    try{context.fillStyle='#101114';context.fillRect(0,0,320,180);var factor=Math.min(320/canvas.width,180/canvas.height),w=canvas.width*factor,h=canvas.height*factor;context.drawImage(canvas,(320-w)/2,(180-h)/2,w,h);return target.toDataURL('image/jpeg',.72);}catch(error){
      target=document.createElement('canvas');var p=snapshot || project,mode=p.mode || 'cards',item={kind:mode==='highlight'?'highlight':(mode==='trapezoid'?'split':'row'),colors:['#4ea1ff','#ef9b35']};
      if(mode==='trapezoid'){item.angle=p.trapezoid.angle;item.colors=['#e5b64f','#53a2af','#a084c6'];}drawPresetThumbnail(target,item,p);return target.toDataURL('image/png');
    }
  },drawThumbnail:function(target,snapshot){var p=snapshot,mode=p.mode || 'cards',item={kind:mode==='highlight'?'highlight':(mode==='trapezoid'?'split':'row'),colors:['#4ea1ff','#ef9b35']};if(mode==='trapezoid'){item.angle=p.trapezoid.angle;item.colors=['#e5b64f','#53a2af','#a084c6'];}drawPresetThumbnail(target,item,p);} };
}());
