(function(){
  'use strict';
  var Lib=window.CardLibrary,Panel=window.CardPanel,$=function(id){return document.getElementById(id);};
  var state,available=true,editingId=null,editingName='',opening=false,groupAction='add',saveAs=false,managingId=null;
  var modes={cards:{name:'カードをめくる',accent:'#ed6ba8'},trapezoid:{name:'台形3分割スライド',accent:'#38c5e0'},highlight:{name:'画像を強調',accent:'#e4de4f'}};
  function text(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function status(message,error){$('status-text').textContent=message;$('status').classList.toggle('error',!!error);$('editor-status').textContent=message;$('editor-status').classList.toggle('error',!!error);}
  function mode(project){return modes[project.mode]?project.mode:'cards';}
  function activeGroup(){return state.groups.find(function(g){return g.id===state.activeGroupId;}) || state.groups[0];}
  function errorMessage(error){if(error.name==='QuotaExceededError' || error.code===22 || error.code===1014)return '保存容量がいっぱいです。不要な演出を整理するか、JSON保存を利用してください。';if(error.name==='SecurityError')return 'この環境ではパネル内に保存できません。JSON保存を利用してください。';return error.message || String(error);}
  function fail(error){status(errorMessage(error),true);}
  try{state=Lib.load(localStorage);}catch(error){state=Lib.create();available=false;$('library-warning').hidden=false;$('library-warning').textContent=error.message+' 編集内容は「JSON保存」で保存できます。';fail(error);}
  function transaction(change){
    if(!available)throw new Error('ライブラリに保存できません。「JSON保存」で編集内容を保存してください。');
    // Re-read before changing a record, and commit only a complete new state.
    // A quota error must never mutate the visible or persisted library.
    var next=Lib.clone(Lib.load(localStorage));
    if(next.groups.some(function(g){return g.id===state.activeGroupId;}))next.activeGroupId=state.activeGroupId;
    var result=change(next);Lib.save(localStorage,next);state=next;renderHome();return result;
  }
  function groupOptions(select,selected){select.innerHTML=state.groups.map(function(g){return '<option value="'+text(g.id)+'">'+text(g.name)+'</option>';}).join('');select.value=state.groups.some(function(g){return g.id===selected;})?selected:activeGroup().id;}
  function renderHome(){
    var current=activeGroup(),items=state.presets.filter(function(p){return p.groupId===current.id;});
    $('group-tabs').innerHTML=state.groups.map(function(g){var active=g.id===current.id;return '<button class="group-tab" role="tab" data-group="'+text(g.id)+'" aria-selected="'+active+'" aria-controls="saved-gallery" tabindex="'+(active?'0':'-1')+'" title="'+text(g.name)+'">'+text(g.name)+'</button>';}).join('');
    $('group-heading').textContent=current.name;$('saved-count').textContent=items.length;$('empty-group').hidden=!!items.length || !available;
    $('saved-gallery').innerHTML=items.map(function(p){var info=modes[mode(p.project)];return '<article class="preset-tile" style="--preset-accent:'+info.accent+'"><button class="preset-open" data-open-preset="'+text(p.id)+'" aria-label="'+text(p.name)+'を編集"><span class="preset-art"><canvas width="320" height="180" aria-hidden="true"></canvas><span class="preset-mode-badge">'+info.name+'</span></span><span class="preset-title">'+text(p.name)+'</span><span class="preset-subtitle">編集して保存した演出</span></button><button class="preset-menu" data-manage-preset="'+text(p.id)+'" aria-label="'+text(p.name)+'の名前・グループ・削除" title="名前・グループ・削除">⋯</button></article>';}).join('');
    Array.from($('saved-gallery').querySelectorAll('.preset-tile')).forEach(function(tile,index){var p=items[index],target=tile.querySelector('canvas');
      if(typeof p.thumbnail==='string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(p.thumbnail)){
        var image=document.createElement('img');image.alt='';image.src=p.thumbnail;target.replaceWith(image);
      }else try{Panel.drawThumbnail(target,p.project);}catch(error){var c=target.getContext('2d');c.fillStyle='#20232a';c.fillRect(0,0,320,180);c.fillStyle='#a3b2c9';c.font='48px sans-serif';c.fillText('▦',136,110);}
    });
    syncBusy();window.dispatchEvent(new CustomEvent('cardreveal:library-changed'));
  }
  function syncBusy(){var busy=Panel.isBusy();$('close-editor').disabled=busy;$('save-to-group').disabled=busy || !available;$('save-copy').disabled=busy || !available;
    document.querySelectorAll('[data-template-mode],[data-group],[data-open-preset],[data-manage-preset],#add-group,#rename-group').forEach(function(button){button.disabled=busy || (!available && !button.dataset.templateMode);});$('delete-group').disabled=busy || !available || state.groups.length<2;
  }
  function chooseGroup(groupId,focus){if(Panel.isBusy())return;try{transaction(function(next){if(!next.groups.some(function(g){return g.id===groupId;}))throw new Error('グループが見つかりません。');next.activeGroupId=groupId;});if(focus){var button=Array.from($('group-tabs').querySelectorAll('[data-group]')).find(function(b){return b.dataset.group===groupId;});if(button)button.focus();}}catch(error){fail(error);}}
  $('group-tabs').addEventListener('click',function(event){var button=event.target.closest('[data-group]');if(button)chooseGroup(button.dataset.group,false);});
  $('group-tabs').addEventListener('keydown',function(event){if(Panel.isBusy())return;var button=event.target.closest('[data-group]');if(!button)return;var index=state.groups.findIndex(function(g){return g.id===button.dataset.group;}),next;
    if(event.key==='ArrowRight')next=(index+1)%state.groups.length;else if(event.key==='ArrowLeft')next=(index+state.groups.length-1)%state.groups.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=state.groups.length-1;else return;event.preventDefault();chooseGroup(state.groups[next].id,true);
  });
  $('thumbnail-zoom').addEventListener('input',function(){$('saved-gallery').style.setProperty('--tile-width',this.value+'px');});
  function showEditor(){
    $('editor-title').textContent=editingName || modes[mode(Panel.getProject())].name;$('editor-source').textContent=editingId?'保存した演出を編集':'元の演出から新しく作成';$('save-to-group').textContent=editingId?'変更を保存':'グループに保存';
    if(!$('editor-dialog').open)$('editor-dialog').showModal();
    requestAnimationFrame(function(){Panel.fit();Panel.draw();$('editor-title').tabIndex=-1;$('editor-title').focus();});syncBusy();
  }
  function replace(project,presetId,label){
    if(Panel.isBusy())return;
    if($('editor-dialog').open && Panel.isDirty() && !window.confirm('現在の編集を保存せず、別の演出を開きますか？'))return;
    try{opening=true;Panel.setProject(Lib.clone(project));editingId=presetId || null;editingName=label || '';showEditor();}catch(error){fail(error);}finally{opening=false;}
  }
  document.querySelectorAll('[data-template-mode]').forEach(function(button){button.addEventListener('click',function(){if(Panel.isBusy())return;replace(Lib.baseProject(button.dataset.templateMode),null,'');status('元の演出を開きました。素材や設定を調整して、グループに保存できます。');});});
  window.addEventListener('cardreveal:project-loaded',function(){if(opening)return;editingId=null;editingName='';showEditor();});
  window.addEventListener('cardreveal:busy',syncBusy);
  function closeEditor(){if(Panel.isBusy())return;if(Panel.isDirty() && !window.confirm('編集内容を保存せずに一覧へ戻りますか？'))return;Panel.pause();Panel.setDirty(false);$('editor-dialog').close();renderHome();}
  $('close-editor').addEventListener('click',closeEditor);$('editor-dialog').addEventListener('cancel',function(event){event.preventDefault();closeEditor();});
  function openSave(copy){
    if(Panel.isBusy() || !available)return;Panel.pause();saveAs=!!copy;
    var existing=state.presets.find(function(p){return p.id===editingId;}),baseName=editingName || modes[mode(Panel.getProject())].name;
    $('preset-name').value=copy?baseName+' コピー':baseName;groupOptions($('save-group'),existing?existing.groupId:activeGroup().id);$('save-error').textContent='';$('save-dialog-title').textContent=existing && !copy?'保存した演出を更新':'編集した演出を保存';$('save-dialog').showModal();$('preset-name').select();
  }
  $('save-to-group').addEventListener('click',function(){openSave(false);});$('save-copy').addEventListener('click',function(){openSave(true);});
  $('save-form').addEventListener('submit',function(event){event.preventDefault();if(Panel.isBusy() || !available)return;
    try{if(Panel.isMediaPending())throw new Error('素材を読み込んでいます。読み込みが終わってから保存してください。');var snapshot=Lib.clone(Panel.getProject()),thumbnail=Panel.thumbnail(snapshot),value=transaction(function(next){return Lib.savePreset(next,{id:saveAs?null:editingId,name:$('preset-name').value,groupId:$('save-group').value,project:snapshot,thumbnail:thumbnail});});
      editingId=value.id;editingName=value.name;Panel.setDirty(false);$('save-dialog').close();$('editor-dialog').close();status('「'+value.name+'」を「'+activeGroup().name+'」に保存しました。サムネイルから再編集できます。');
    }catch(error){$('save-error').textContent='保存できませんでした。'+errorMessage(error)+' JSON保存も利用できます。';}
  });
  function openGroup(action){if(Panel.isBusy() || !available)return;groupAction=action;$('group-dialog-title').textContent=action==='add'?'グループを追加':'グループ名を変更';$('confirm-group').textContent=action==='add'?'作成':'変更';$('group-name').value=action==='add'?'':activeGroup().name;$('group-error').textContent='';$('group-dialog').showModal();$('group-name').focus();$('group-name').select();}
  $('add-group').addEventListener('click',function(){openGroup('add');});$('rename-group').addEventListener('click',function(){openGroup('rename');});
  $('group-form').addEventListener('submit',function(event){event.preventDefault();if(Panel.isBusy())return;try{transaction(function(next){if(groupAction==='add')Lib.addGroup(next,$('group-name').value);else Lib.renameGroup(next,activeGroup().id,$('group-name').value);});$('group-dialog').close();status('グループを保存しました。');}catch(error){$('group-error').textContent=error.message || String(error);}});
  $('delete-group').addEventListener('click',function(){if(Panel.isBusy() || !available || state.groups.length<2)return;var current=activeGroup(),target=state.groups.find(function(g){return g.id!==current.id;});if(!window.confirm('「'+current.name+'」を削除しますか？ 保存した演出は「'+target.name+'」へ移します。同じ名前がある場合は番号を付けます。'))return;try{transaction(function(next){Lib.removeGroup(next,current.id,target.id);});status('グループを削除し、保存した演出を移しました。');}catch(error){fail(error);}});
  $('saved-gallery').addEventListener('click',function(event){if(Panel.isBusy())return;var open=event.target.closest('[data-open-preset]'),manage=event.target.closest('[data-manage-preset]');
    if(open){var p=state.presets.find(function(p){return p.id===open.dataset.openPreset;});if(p){replace(p.project,p.id,p.name);status('「'+p.name+'」を開きました。変更は保存するまで元の演出に反映されません。');}}
    else if(manage){var item=state.presets.find(function(p){return p.id===manage.dataset.managePreset;});if(!item)return;managingId=item.id;$('manage-name').value=item.name;groupOptions($('manage-group'),item.groupId);$('manage-error').textContent='';$('manage-dialog').showModal();}
  });
  $('manage-form').addEventListener('submit',function(event){event.preventDefault();if(Panel.isBusy())return;try{transaction(function(next){Lib.editPreset(next,managingId,$('manage-name').value,$('manage-group').value);});$('manage-dialog').close();status('演出の名前と保存先を変更しました。');}catch(error){$('manage-error').textContent=error.message || String(error);}});
  $('delete-preset').addEventListener('click',function(){if(Panel.isBusy())return;var item=state.presets.find(function(p){return p.id===managingId;});if(!item || !window.confirm('「'+item.name+'」を削除しますか？'))return;try{transaction(function(next){Lib.removePreset(next,managingId);});$('manage-dialog').close();status('保存した演出を削除しました。');}catch(error){$('manage-error').textContent=error.message || String(error);}});
  document.querySelectorAll('[data-close-dialog]').forEach(function(button){button.addEventListener('click',function(){$(button.dataset.closeDialog).close();});});
  window.addEventListener('storage',function(event){if(event.key!==Lib.key || Panel.isBusy())return;try{state=Lib.load(localStorage);available=true;renderHome();}catch(error){fail(error);}});
  renderHome();
  window.CardLibraryPanel={getState:function(){return Lib.clone(state);},openTemplate:function(mode){replace(Lib.baseProject(mode),null,'');},getEditingId:function(){return editingId;},commit:transaction,isAvailable:function(){return available;}};
}());
