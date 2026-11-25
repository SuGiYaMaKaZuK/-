(function(){
  'use strict';
  var Lib=window.CardLibrary,Library=window.CardLibraryPanel,Panel=window.CardPanel,Bridge=window.CardBridge || {hasHost:false},$=function(id){return document.getElementById(id);};
  var draft=null,draftGroups=null,sabuBaseline=null,sabuStored=null,source=null,edition=0,drag=null,timelineBusy=false,canvas=$('sabu-preview'),ctx=canvas.getContext('2d');
  function text(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function assets(){return Library.getPlacements();}
  function status(message,error){$('status-text').textContent=message;$('status').classList.toggle('error',!!error);$('editor-status').textContent=message;$('editor-status').classList.toggle('error',!!error);}
  function errorText(error){if(error.name==='QuotaExceededError' || error.code===22)return '保存容量がいっぱいです。不要な保存データを整理してください。';return error.message || String(error);}
  function number(value){return Math.round(value*100)/100;}
  function tiles(items,attribute){return items.map(function(a){return '<article class="preset-tile sabu-tile"><button class="preset-open" '+attribute+'="'+text(a.id)+'" aria-label="'+text(a.name)+(attribute==='data-sabu-edit'?'の素材と配置を編集':'を選択中の素材に適用')+'"><span class="preset-art"><span class="preset-mode-badge">'+(a.mediaType==='video'?'動画':'画像')+'・配置</span></span><span class="preset-title">'+text(a.name)+'</span><span class="preset-subtitle">'+number(a.mediaScale)+'% · X '+number(a.mediaX)+' · Y '+number(a.mediaY)+'</span></button></article>';}).join('');}
  var placeholders={};
  function placeholder(kind){
    if(!placeholders[kind]){
      var canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      var context=canvas.getContext('2d');context.fillStyle='#17202a';context.fillRect(0,0,320,180);
      context.fillStyle='#91a9c3';context.font='44px sans-serif';context.fillText(kind==='video'?'▶':'▧',139,110);
      placeholders[kind]=canvas.toDataURL('image/png');
    }
    return placeholders[kind];
  }
  function thumbnails(container,items){
    Array.from(container.querySelectorAll('.preset-art')).forEach(function(art,index){
      var asset=items[index],image=document.createElement('img');
      image.alt='';image.loading='lazy';
      if(typeof asset.thumbnail==='string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(asset.thumbnail)){
        image.src=asset.thumbnail;
      }else if(asset.mediaType==='image'){
        image.onerror=function(){image.remove();};image.src=mediaURL(asset.mediaPath);
      }else{
        image.src=placeholder('video');
      }
      art.prepend(image);
    });
  }
  function renderGallery(picker){
    var dialog=$(picker?'sabu-picker-dialog':'assets-library-dialog');
    if(!dialog.open)return;
    var prefix=picker?'sabu-picker':'sabu',gallery=$(prefix+'-gallery'),empty=$(prefix+'-empty');
    var all=assets(),query=$(prefix+'-search').value.trim().toLocaleLowerCase();
    var matches=query?all.filter(function(asset){
      return (asset.name+' '+(asset.sourceName || '')+' '+(asset.mediaType==='video'?'動画':'画像')).toLocaleLowerCase().indexOf(query)>=0;
    }):all;
    if(!picker){
      $('sabu-count').textContent=query?matches.length+'/'+all.length:all.length;
      if($('sabu-content').hidden){gallery.replaceChildren();return;}
    }
    gallery.innerHTML=tiles(matches,picker?'data-sabu-apply':'data-sabu-edit');
    thumbnails(gallery,matches);
    empty.hidden=!!matches.length;
    empty.textContent=all.length?'一致する素材はありません。検索条件を変えてください。':(picker?'保存した素材はまだありません。':'画像・動画と大きさ・X/Yを保存できます。編集画面の「素材と配置から読み込む」から、別の演出に使えます。');
    syncBusy();
  }
  function refreshGalleries(){
    if(!$('assets-library-dialog').open && !$('sabu-picker-dialog').open){syncBusy();return;}
    renderGallery(false);renderGallery(true);
  }
  [false,true].forEach(function(picker){
    var prefix=picker?'sabu-picker':'sabu',dialog=$(picker?'sabu-picker-dialog':'assets-library-dialog');
    $(prefix+'-search').addEventListener('input',function(){renderGallery(picker);});
    $(prefix+'-search').addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.value='';renderGallery(picker);}
    });
    dialog.addEventListener('close',function(){if(!dialog.open)$(prefix+'-gallery').replaceChildren();});
  });
  $('open-assets-library').addEventListener('click',function(){
    if(Panel.isBusy() || timelineBusy || !Library.isAvailable())return;
    $('assets-library-dialog').showModal();renderGallery(false);
  });
  function syncBusy(){var busy=Panel.isBusy() || timelineBusy,unavailable=!Library.isAvailable();$('add-sabu').disabled=busy || unavailable;$('open-sabu-picker').disabled=busy || unavailable;$('capture-sabu').disabled=busy || unavailable;$('save-sabu').disabled=busy || unavailable || !!(source && !source.ready && !source.failed);$('delete-sabu').disabled=busy || unavailable;document.querySelectorAll('[data-sabu-edit],[data-sabu-apply]').forEach(function(button){button.disabled=busy;});}
  $('sabu-tab').addEventListener('click',function(){var expanded=this.getAttribute('aria-expanded')==='true';this.setAttribute('aria-expanded',String(!expanded));$('sabu-content').hidden=expanded;document.querySelector('.sabu-library').classList.toggle('collapsed',expanded);renderGallery(false);});
  function release(){drag=null;canvas.classList.remove('dragging','movable');if(!source)return;if(source.el.tagName==='VIDEO'){source.el.pause();source.el.removeAttribute('src');source.el.load();}if(source.objectURL)URL.revokeObjectURL(source.url);source=null;}
  function mediaURL(path){if(Bridge.mediaURL)return Bridge.mediaURL(path);if(/^(https?:|file:|data:|blob:)/i.test(path))return path;return encodeURI('file:///'+path.replace(/\\/g,'/').replace(/^\/+/, '')).replace(/#/g,'%23').replace(/\?/g,'%3F');}
  function draw(){
    var w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0f1115';ctx.fillRect(0,0,w,h);if(!draft)return;
    var k=Math.min((w-36)/draft.frameWidth,(h-30)/draft.frameHeight),fw=draft.frameWidth*k,fh=draft.frameHeight*k,x=(w-fw)/2,y=(h-fh)/2;
    ctx.save();ctx.beginPath();ctx.rect(x,y,fw,fh);ctx.clip();ctx.fillStyle='#252930';ctx.fillRect(x,y,fw,fh);ctx.fillStyle='#2e333b';for(var row=0;row<Math.ceil(fh/14);row++)for(var col=0;col<Math.ceil(fw/14);col++)if((row+col)%2===0)ctx.fillRect(x+col*14,y+row*14,14,14);
    if(source && source.ready){var sw=source.el.videoWidth || source.el.naturalWidth,sh=source.el.videoHeight || source.el.naturalHeight,factor=Math.max(fw/sw,fh/sh)*draft.mediaScale/100,dw=sw*factor,dh=sh*factor;ctx.drawImage(source.el,(w-dw)/2+draft.mediaX*k,(h-dh)/2+draft.mediaY*k,dw,dh);}
    ctx.restore();ctx.strokeStyle='#7b8b9f';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,fw-1,fh-1);
  }
  function syncFields(){if(!draft)return;$('sabu-name').value=draft.name || '';$('sabu-scale').value=draft.mediaScale;$('sabu-scale-slider').value=draft.mediaScale;$('sabu-x').value=draft.mediaX;$('sabu-y').value=draft.mediaY;$('sabu-x').min=-draft.referenceWidth*2;$('sabu-x').max=draft.referenceWidth*2;$('sabu-y').min=-draft.referenceHeight*2;$('sabu-y').max=draft.referenceHeight*2;$('sabu-source-name').textContent=draft.sourceName || '画像・動画をここにドロップできます';}
  function load(info,fit){
    release();var token=edition,el=document.createElement(info.type==='video'?'video':'img'),item={el:el,url:info.url || mediaURL(info.path),objectURL:!!info.objectURL,ready:false,failed:false};source=item;
    draft.mediaPath=info.path || '';draft.mediaType=info.type || 'image';draft.sourceName=info.name || draft.sourceName || info.path.split(/[\\/]/).pop();
    el.addEventListener(info.type==='video'?'loadeddata':'load',function(){if(edition!==token || source!==item || !draft)return;item.ready=true;canvas.classList.add('movable');if(fit){var sw=el.videoWidth || el.naturalWidth,sh=el.videoHeight || el.naturalHeight,f=Math.min(draft.referenceWidth*.8/sw,draft.referenceHeight*.8/sh);draft.frameWidth=Math.max(16,Math.round(sw*f));draft.frameHeight=Math.max(16,Math.round(sh*f));}syncFields();draw();syncBusy();});
    el.addEventListener('error',function(){if(source!==item || edition!==token)return;item.failed=true;$('sabu-error').textContent='この素材はプレビューできません。素材の場所・形式を確認してください。';syncBusy();});
    if(info.type==='video'){el.muted=true;el.preload='auto';el.playsInline=true;el.addEventListener('seeked',draw);}el.src=item.url;syncFields();draw();syncBusy();
  }
  function sabuSnapshot(){if(!draft)return '';var value={};['name','mediaPath','mediaType','mediaScale','mediaX','mediaY','referenceWidth','referenceHeight','frameWidth','frameHeight'].forEach(function(key){value[key]=draft[key];});return JSON.stringify(value);}
  function requestClose(){if(!draft || sabuSnapshot()===sabuBaseline){$('sabu-dialog').close();return;}if(!$('close-sabu-dialog').open)$('close-sabu-dialog').showModal();}
  $('sabu-dialog').addEventListener('click',function(event){if(!event.target.closest('[data-close-dialog="sabu-dialog"]'))return;event.preventDefault();event.stopImmediatePropagation();requestClose();},true);
  $('sabu-dialog').addEventListener('cancel',function(event){event.preventDefault();requestClose();});
  $('keep-sabu-editing').addEventListener('click',function(){$('close-sabu-dialog').close();});
  $('discard-sabu').addEventListener('click',function(){$('close-sabu-dialog').close();$('sabu-dialog').close();});
  $('save-and-close-sabu').addEventListener('click',function(){$('close-sabu-dialog').close();$('sabu-form').requestSubmit();});
  function open(asset,groups){if(Panel.isBusy() || !Library.isAvailable())return;draftGroups=groups || null;Panel.pause();edition++;release();draft=asset?Lib.clone(asset):{name:'',mediaPath:'',mediaType:'image',sourceName:'',mediaScale:100,mediaX:0,mediaY:0,referenceWidth:1920,referenceHeight:1080,frameWidth:960,frameHeight:540};if(!draft.id && draft.name)draft.name=Lib.availableName(draft.name,assets().map(function(a){return a.name;}));sabuBaseline=asset && !asset.id?'':sabuSnapshot();sabuStored=asset && asset.id?JSON.stringify(asset):null;$('sabu-error').textContent='';$('sabu-title').textContent=asset && asset.id?'保存した素材と配置を編集':'素材と配置を保存';$('delete-sabu').hidden=!(asset && asset.id);syncFields();draw();$('sabu-dialog').showModal();if(draft.mediaPath)load({path:draft.mediaPath,type:draft.mediaType,name:draft.sourceName},false);}
  $('media-collection-manage').addEventListener('click',function(){
    var groups=Library.getState().mediaGroups;
    open(null,{image:groups.image.activeGroupId,video:groups.video.activeGroupId});
  });
  $('add-sabu').addEventListener('click',function(){open(null);});$('sabu-gallery').addEventListener('click',function(event){var button=event.target.closest('[data-sabu-edit]');if(button){var a=assets().find(function(a){return a.id===button.dataset.sabuEdit;});if(a)open(a);}});
  $('open-sabu-picker').addEventListener('click',function(){if(Panel.isBusy() || !Library.isAvailable())return;Panel.pause();$('sabu-picker-error').textContent='';$('sabu-picker-dialog').showModal();renderGallery(true);});
  $('capture-sabu').addEventListener('click',function(){if(Panel.isBusy())return;try{if(Panel.isMediaPending())throw new Error('素材を読み込んでいます。完了してから保存してください。');var p=Panel.getPlacement();p.name=String(p.sourceName || '素材と配置').slice(0,40);open(p);}catch(error){$('sabu-picker-error').textContent=errorText(error);}});
  $('sabu-picker-gallery').addEventListener('click',function(event){var button=event.target.closest('[data-sabu-apply]');if(!button || Panel.isBusy())return;var a=assets().find(function(a){return a.id===button.dataset.sabuApply;});if(!a)return;try{Panel.applyPlacement(a);$('sabu-picker-dialog').close();}catch(error){$('sabu-picker-error').textContent=errorText(error);}});
  function chooseSource(info) {
    if(!draft || !info || !$('sabu-dialog').open)return;
    $('sabu-error').textContent='';draft.mediaScale=100;draft.mediaX=0;draft.mediaY=0;
    if(!draft.name)draft.name=Lib.availableName(info.name || '素材と配置',assets().map(function(a){return a.name;}));
    load(info,true);
  }
  var sourceArea=$('sabu-dialog').querySelector('.sabu-preview');
  window.CardMediaDrop.bind(sourceArea, {
    available:function(){return !!draft && $('sabu-dialog').open && !$('close-sabu-dialog').open && !Panel.isBusy();},
    target:function(){return sourceArea;},receive:function(files){chooseSource(files[0]);},
    error:function(error){$('sabu-error').textContent=errorText(error);}
  });
  $('choose-sabu-media').addEventListener('click',function(){if(!draft || Panel.isBusy())return;var token=edition;if(Bridge.hasHost && Bridge.pickMedia){Bridge.pickMedia().then(function(info){if(token===edition)chooseSource(info);}).catch(function(error){if(token===edition)$('sabu-error').textContent=errorText(error);});}else{$('sabu-media-input').value='';$('sabu-media-input').click();}});
  $('sabu-media-input').addEventListener('change',function(){if(!draft || !$('sabu-dialog').open)return;var f=this.files[0];if(f)chooseSource({path:f.path || '',name:f.name,type:f.type.indexOf('video/')===0?'video':'image',url:URL.createObjectURL(f),objectURL:true});});
  ['sabu-scale','sabu-x','sabu-y'].forEach(function(id){$(id).required=true;$(id).addEventListener('input',function(){if(!draft || this.value==='')return;var value=Number(this.value);if(!Number.isFinite(value))return;var key=id==='sabu-scale'?'mediaScale':(id==='sabu-x'?'mediaX':'mediaY');draft[key]=value;if(key==='mediaScale')$('sabu-scale-slider').value=value;draw();});});
  $('sabu-name').addEventListener('input',function(){if(draft)draft.name=this.value;});
  $('sabu-scale-slider').addEventListener('input',function(){if(!draft)return;draft.mediaScale=Number(this.value);$('sabu-scale').value=draft.mediaScale;draw();});
  function position(x,y){if(!draft)return;draft.mediaX=Math.round(Math.max(-draft.referenceWidth*2,Math.min(draft.referenceWidth*2,x))*100)/100;draft.mediaY=Math.round(Math.max(-draft.referenceHeight*2,Math.min(draft.referenceHeight*2,y))*100)/100;$('sabu-x').value=draft.mediaX;$('sabu-y').value=draft.mediaY;draw();}
  $('center-sabu').addEventListener('click',function(){position(0,0);});
  function point(event){var rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};}
  canvas.addEventListener('pointerdown',function(event){if(!draft || !source || !source.ready || event.button!==0 || Panel.isBusy())return;event.preventDefault();var p=point(event);drag={id:event.pointerId,x:p.x,y:p.y,startX:draft.mediaX,startY:draft.mediaY};canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');canvas.focus();});
  canvas.addEventListener('pointermove',function(event){if(!drag || !draft || event.pointerId!==drag.id)return;var p=point(event),k=Math.min((canvas.width-36)/draft.frameWidth,(canvas.height-30)/draft.frameHeight);position(drag.startX+(p.x-drag.x)/k,drag.startY+(p.y-drag.y)/k);});
  function stopDrag(){if(drag && canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;canvas.classList.remove('dragging');}
  canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);
  canvas.addEventListener('keydown',function(event){if(!draft || Panel.isBusy())return;var step=event.shiftKey?10:1,x=draft.mediaX,y=draft.mediaY;if(event.key==='ArrowLeft')x-=step;else if(event.key==='ArrowRight')x+=step;else if(event.key==='ArrowUp')y-=step;else if(event.key==='ArrowDown')y+=step;else return;event.preventDefault();position(x,y);});
  document.addEventListener('keydown',function(event){if(!$('sabu-dialog').open || $('close-sabu-dialog').open || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase()!=='s')return;event.preventDefault();if(!Panel.isBusy())$('sabu-form').requestSubmit();});
  $('reset-sabu').addEventListener('click',function(){if(!draft)return;draft.mediaScale=100;draft.mediaX=0;draft.mediaY=0;syncFields();draw();});
  function thumbnail(){var target=document.createElement('canvas');target.width=320;target.height=180;try{target.getContext('2d').drawImage(canvas,0,0,320,180);return target.toDataURL('image/jpeg',.72);}catch(error){return placeholder(draft.mediaType);}}
  $('sabu-form').addEventListener('submit',function(event){event.preventDefault();if(!draft || Panel.isBusy())return;try{if(source && !source.ready && !source.failed)throw new Error('素材を読み込んでいます。完了してから保存してください。');draft.name=$('sabu-name').value;draft.mediaScale=Number($('sabu-scale').value);draft.mediaX=Number($('sabu-x').value);draft.mediaY=Number($('sabu-y').value);draft.thumbnail=thumbnail();var value=Library.commit(function(next){if(draft.id && JSON.stringify((next.assets || []).find(function(a){return a.id===draft.id;}))!==sabuStored)throw new Error('この素材と配置素材は別の画面で更新されています。現在の変更を確認してから開き直してください。');var saved=Lib.savePlacement(next,draft);if(draftGroups)window.CardMediaGroups.assign(next,saved.mediaType,[saved.mediaPath],draftGroups[saved.mediaType]);return saved;});if($('sabu-search').value){$('sabu-search').value='';renderGallery(false);}if($('sabu-picker-search').value){$('sabu-picker-search').value='';renderGallery(true);}$('sabu-dialog').close();status('「'+value.name+'」の素材と配置を保存しました。');}catch(error){$('sabu-error').textContent=errorText(error);}});
  $('delete-sabu').addEventListener('click',function(){if(!draft || !draft.id || Panel.isBusy() || !window.confirm('「'+draft.name+'」を素材と配置から削除しますか？'))return;try{Library.commit(function(next){Lib.removePlacement(next,draft.id);});$('sabu-dialog').close();status('素材と配置の保存データを削除しました。');}catch(error){$('sabu-error').textContent=errorText(error);}});
  $('sabu-dialog').addEventListener('close',function(){if(this.open)return;edition++;release();draft=null;draftGroups=null;sabuBaseline=null;sabuStored=null;});
  window.addEventListener('cardreveal:library-changed',refreshGalleries);window.addEventListener('cardreveal:busy',syncBusy);window.addEventListener('cardreveal:title-busy',function(event){timelineBusy=!!event.detail.busy;syncBusy();});syncBusy();
}());
