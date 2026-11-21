(function(){
  'use strict';
  var Lib=window.CardLibrary,Panel=window.CardPanel,$=function(id){return document.getElementById(id);};
  var state,available=true,editingId=null,editingName='',opening=false,groupAction='add',saveAs=false,managingId=null,editorBaseline=null,saveTargetId=null,updatePending=false,timelineBusy=false;
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
    var current=activeGroup(),allItems=state.presets.filter(function(p){return p.groupId===current.id;}).map(function(p){return {kind:'effect',value:p};}),query=$('main-search').value.trim().toLocaleLowerCase(),items=allItems.filter(function(row){return !query || (row.value.name+' '+modes[mode(row.value.project)].name).toLocaleLowerCase().indexOf(query)>=0;});
    $('group-tabs').innerHTML=state.groups.map(function(g){var active=g.id===current.id;return '<button class="group-tab" role="tab" data-group="'+text(g.id)+'" aria-selected="'+active+'" aria-controls="saved-gallery title-gallery" tabindex="'+(active?'0':'-1')+'" title="'+text(g.name)+'">'+text(g.name)+'</button>';}).join('');
    $('group-heading').textContent=current.name;$('saved-count').textContent=query?items.length+'/'+allItems.length:allItems.length;$('empty-group').hidden=!!allItems.length || !available;$('main-search-empty').hidden=!query || !!items.length || !allItems.length;
    $('saved-gallery').innerHTML=items.map(function(row){var p=row.value;var info=modes[mode(p.project)];return '<article class="preset-tile" style="--preset-accent:'+info.accent+'"><button class="preset-open" data-open-preset="'+text(p.id)+'" aria-label="'+text(p.name)+'を編集"><span class="preset-art"><canvas width="320" height="180" aria-hidden="true"></canvas><span class="preset-mode-badge">'+info.name+'</span></span><span class="preset-title">'+text(p.name)+'</span><span class="preset-subtitle">編集して保存した演出</span></button><button class="preset-menu" data-manage-preset="'+text(p.id)+'" aria-label="'+text(p.name)+'の名前・グループ・削除" title="名前・グループ・削除">⋯</button></article>';}).join('');
    Array.from($('saved-gallery').querySelectorAll('.preset-tile')).forEach(function(tile,index){var row=items[index],p=row.value,target=tile.querySelector('canvas');      if(typeof p.thumbnail==='string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(p.thumbnail)){
        var image=document.createElement('img');image.alt='';image.src=p.thumbnail;target.replaceWith(image);
      }else try{Panel.drawThumbnail(target,p.project);}catch(error){var c=target.getContext('2d');c.fillStyle='#20232a';c.fillRect(0,0,320,180);c.fillStyle='#a3b2c9';c.font='48px sans-serif';c.fillText('▦',136,110);}
    });
    renderTitles();syncBusy();window.dispatchEvent(new CustomEvent('cardreveal:library-changed'));
  }
  function renderTitles(){var current=activeGroup(),all=(state.titles || []).filter(function(t){return t.groupId===current.id;}),q=$('title-search').value.trim().toLocaleLowerCase(),items=all.filter(function(t){return !q || (t.name+' '+(t.sourceName || '')+' テロップ MOGRT').toLocaleLowerCase().indexOf(q)>=0;});
    $('title-group-heading').textContent=current.name;$('title-count').textContent=q?items.length+'/'+all.length:all.length;$('title-empty').hidden=!!items.length;$('title-empty').textContent=all.length?'一致するテロップはありません。検索条件を変えてください。':'このグループにはテロップがありません。.mogrtを登録すると1クリックで挿入できます。';
    $('title-gallery').innerHTML=items.map(function(t){return '<article class="preset-tile title-tile"><button class="preset-open" data-insert-title="'+text(t.id)+'" aria-label="'+text(t.name)+'を再生ヘッドへ挿入" title="1クリックでタイムラインに挿入"><span class="preset-art"><canvas width="320" height="180" aria-hidden="true"></canvas><span class="preset-mode-badge">テロップ / MOGRT</span></span><span class="preset-title">'+text(t.name)+'</span><span class="preset-subtitle title-insert-hint">＋ 再生ヘッドへ挿入</span></button><button class="preset-menu" data-manage-title="'+text(t.id)+'" aria-label="'+text(t.name)+'の登録設定" title="名前・グループ・挿入先・削除">⋯</button></article>';}).join('');
    $('title-gallery').querySelectorAll('canvas').forEach(function(target){var c=target.getContext('2d');c.fillStyle='#111923';c.fillRect(0,0,320,180);c.fillStyle='#263c55';c.fillRect(35,81,250,58);c.fillStyle='#eff6ff';c.font='bold 42px sans-serif';c.textAlign='center';c.fillText('T',160,65);c.font='18px sans-serif';c.fillText('テロップ',160,116);});
  }
  function syncBusy(){var busy=Panel.isBusy() || timelineBusy;$('close-editor').disabled=busy;$('save-to-group').disabled=busy || !available;$('save-copy').disabled=busy || !available;
    document.querySelectorAll('[data-template-mode],[data-group],[data-open-preset],[data-manage-preset],[data-insert-title],[data-manage-title],#register-title,#add-title,#title-dropzone,#open-assets-library,#add-group,#rename-group').forEach(function(button){button.disabled=busy || (!available && !button.dataset.templateMode);});$('delete-group').disabled=busy || !available || state.groups.length<2;updateEditorState();
  }
  function chooseGroup(groupId,focus){if(Panel.isBusy() || timelineBusy)return;try{if(groupId!==state.activeGroupId){$('main-search').value='';$('title-search').value='';$('title-drop-error').hidden=true;}transaction(function(next){if(!next.groups.some(function(g){return g.id===groupId;}))throw new Error('グループが見つかりません。');next.activeGroupId=groupId;});if(focus){var button=Array.from($('group-tabs').querySelectorAll('[data-group]')).find(function(b){return b.dataset.group===groupId;});if(button)button.focus();}}catch(error){fail(error);}}
  $('group-tabs').addEventListener('click',function(event){var button=event.target.closest('[data-group]');if(button)chooseGroup(button.dataset.group,false);});
  $('group-tabs').addEventListener('keydown',function(event){if(Panel.isBusy() || timelineBusy)return;var button=event.target.closest('[data-group]');if(!button)return;var index=state.groups.findIndex(function(g){return g.id===button.dataset.group;}),next;
    if(event.key==='ArrowRight')next=(index+1)%state.groups.length;else if(event.key==='ArrowLeft')next=(index+state.groups.length-1)%state.groups.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=state.groups.length-1;else return;event.preventDefault();chooseGroup(state.groups[next].id,true);
  });
  $('thumbnail-zoom').addEventListener('input',function(){$('saved-gallery').style.setProperty('--tile-width',this.value+'px');});
  $('main-search').addEventListener('input',renderHome);
  $('title-search').addEventListener('input',renderHome);
  $('title-search').addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();this.value='';renderHome();}});
  $('main-search').addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();this.value='';renderHome();}});
  function hasEditorChanges(){return editorBaseline!==null && JSON.stringify(Panel.getProject())!==editorBaseline;}
  function updateEditorState(){if(!$('editor-dialog').open)return;var changed=hasEditorChanges(),existing=state.presets.some(function(p){return p.id===editingId;});var label=existing?(changed?'未保存の変更':'保存済み'):'新規・未保存';if($('editor-dirty').textContent!==label)$('editor-dirty').textContent=label;$('editor-dirty').classList.toggle('unsaved',!existing || changed);$('save-to-group').textContent=existing?'変更を保存':'グループに保存';$('save-to-group').title=existing?'変更を保存して編集を続ける（Ctrl+S）':'名前とグループを選んで保存（Ctrl+S）';$('save-copy').title='別名で保存（Ctrl+Shift+S）';}
  function scheduleUpdate(){if(updatePending || !$('editor-dialog').open)return;updatePending=true;requestAnimationFrame(function(){updatePending=false;updateEditorState();});}
  ['input','change','click','pointerup'].forEach(function(type){document.addEventListener(type,scheduleUpdate);});window.addEventListener('cardreveal:state',scheduleUpdate);
  function showEditor(){
    $('editor-title').textContent=editingName || modes[mode(Panel.getProject())].name;$('editor-source').textContent=editingId?'保存した演出を編集':'元の演出から新しく作成';$('save-to-group').textContent=editingId?'変更を保存':'グループに保存';
    if(!$('editor-dialog').open)$('editor-dialog').showModal();
    requestAnimationFrame(function(){Panel.fit();Panel.draw();$('editor-title').tabIndex=-1;$('editor-title').focus();});syncBusy();
  }
  function replace(project,presetId,label){
    if(Panel.isBusy() || timelineBusy)return;
    if($('editor-dialog').open && Panel.isDirty() && !window.confirm('現在の編集を保存せず、別の演出を開きますか？'))return;
    try{opening=true;Panel.setProject(Lib.clone(project));editingId=presetId || null;editingName=label || '';editorBaseline=JSON.stringify(Panel.getProject());showEditor();}catch(error){fail(error);}finally{opening=false;}
  }
  document.querySelectorAll('[data-template-mode]').forEach(function(button){button.addEventListener('click',function(){if(Panel.isBusy() || timelineBusy)return;replace(Lib.baseProject(button.dataset.templateMode),null,'');status('元の演出を開きました。素材や設定を調整して、グループに保存できます。');});});
  window.addEventListener('cardreveal:project-loaded',function(){if(opening)return;editingId=null;editingName='';editorBaseline=JSON.stringify(Panel.getProject());showEditor();});
  window.addEventListener('cardreveal:busy',syncBusy);window.addEventListener('cardreveal:title-busy',function(event){timelineBusy=!!event.detail.busy;syncBusy();});
  function finishClose(){Panel.pause();Panel.setDirty(false);$('editor-dialog').close();renderHome();}
  function closeEditor(){if(Panel.isBusy() || timelineBusy)return;if(hasEditorChanges()){Panel.pause();$('close-editor-error').textContent='';if(!$('close-editor-dialog').open)$('close-editor-dialog').showModal();return;}finishClose();}
  $('close-editor').addEventListener('click',closeEditor);$('editor-dialog').addEventListener('cancel',function(event){event.preventDefault();closeEditor();});
  $('keep-editing').addEventListener('click',function(){$('close-editor-dialog').close();});
  $('discard-editor').addEventListener('click',function(){if(Panel.isBusy() || timelineBusy)return;$('close-editor-dialog').close();finishClose();});
  function openSave(copy){
    if(Panel.isBusy() || timelineBusy || !available)return;Panel.pause();saveAs=!!copy;
    var existing=state.presets.find(function(p){return p.id===editingId;}),baseName=editingName || modes[mode(Panel.getProject())].name;
    var groupId=existing?existing.groupId:activeGroup().id;saveTargetId=existing && !copy?existing.id:null;
    $('preset-name').value=saveTargetId?baseName:Lib.availableName(copy?baseName+' コピー':baseName,state.presets.concat(state.titles || []).filter(function(p){return p.groupId===groupId;}).map(function(p){return p.name;}));groupOptions($('save-group'),groupId);$('save-error').textContent='';$('save-dialog-title').textContent=existing && !copy?'保存した演出を更新':'編集した演出を保存';$('save-dialog').showModal();$('preset-name').select();
  }
  function saveExisting(closeAfter){
    if(Panel.isBusy() || timelineBusy || !available)return false;try{if(Panel.isMediaPending())throw new Error('素材を読み込んでいます。完了してから保存してください。');var snapshot=Lib.clone(Panel.getProject()),thumbnail=Panel.thumbnail(snapshot),value=transaction(function(next){var latest=next.presets.find(function(p){return p.id===editingId;});if(!latest)throw new Error('保存先が見つかりません。別名で保存してください。');if(editorBaseline!==null && JSON.stringify(window.CardModel.upgrade(Lib.clone(latest.project)))!==editorBaseline)throw new Error('この演出は別の画面で更新されています。現在の編集は別名で保存してください。');return Lib.savePreset(next,{id:latest.id,name:latest.name,groupId:latest.groupId,project:snapshot,thumbnail:thumbnail});});editingName=value.name;Panel.setDirty(false);editorBaseline=JSON.stringify(Panel.getProject());$('editor-title').textContent=editingName;updateEditorState();if($('close-editor-dialog').open)$('close-editor-dialog').close();if(closeAfter)finishClose();status('「'+value.name+'」の変更を保存しました。',false);return true;
    }catch(error){fail(error);$('close-editor-error').textContent=errorMessage(error);return false;}
  }
  function saveCurrent(){if(Panel.isBusy() || timelineBusy)return;if(state.presets.some(function(p){return p.id===editingId;}))saveExisting(false);else openSave(false);}
  function saveAndClose(){if(Panel.isBusy() || timelineBusy)return;if(state.presets.some(function(p){return p.id===editingId;}))saveExisting(true);else{$('close-editor-dialog').close();openSave(false);}}
  $('save-and-close').addEventListener('click',saveAndClose);
  $('save-to-group').addEventListener('click',saveCurrent);$('save-copy').addEventListener('click',function(){openSave(true);});
  $('save-form').addEventListener('submit',function(event){event.preventDefault();if(Panel.isBusy() || timelineBusy || !available)return;
    try{if(Panel.isMediaPending())throw new Error('素材を読み込んでいます。読み込みが終わってから保存してください。');var snapshot=Lib.clone(Panel.getProject()),thumbnail=Panel.thumbnail(snapshot),value=transaction(function(next){return Lib.savePreset(next,{id:saveTargetId,name:$('preset-name').value,groupId:$('save-group').value,project:snapshot,thumbnail:thumbnail});});
      editingId=value.id;editingName=value.name;Panel.setDirty(false);editorBaseline=JSON.stringify(Panel.getProject());$('save-dialog').close();$('editor-dialog').close();$('main-search').value='';renderHome();status('「'+value.name+'」を「'+activeGroup().name+'」に保存しました。サムネイルから再編集できます。');
    }catch(error){$('save-error').textContent='保存できませんでした。'+errorMessage(error)+' JSON保存も利用できます。';}
  });
  function openGroup(action){if(Panel.isBusy() || timelineBusy || !available)return;groupAction=action;$('group-dialog-title').textContent=action==='add'?'グループを追加':'グループ名を変更';$('confirm-group').textContent=action==='add'?'作成':'変更';$('group-name').value=action==='add'?'':activeGroup().name;$('group-error').textContent='';$('group-dialog').showModal();$('group-name').focus();$('group-name').select();}
  $('add-group').addEventListener('click',function(){openGroup('add');});$('rename-group').addEventListener('click',function(){openGroup('rename');});
  $('group-form').addEventListener('submit',function(event){event.preventDefault();if(Panel.isBusy() || timelineBusy)return;try{transaction(function(next){if(groupAction==='add')Lib.addGroup(next,$('group-name').value);else Lib.renameGroup(next,activeGroup().id,$('group-name').value);});$('group-dialog').close();status('グループを保存しました。');}catch(error){$('group-error').textContent=error.message || String(error);}});
  $('delete-group').addEventListener('click',function(){if(Panel.isBusy() || timelineBusy || !available || state.groups.length<2)return;var current=activeGroup(),target=state.groups.find(function(g){return g.id!==current.id;});if(!window.confirm('「'+current.name+'」を削除しますか？ 保存した演出は「'+target.name+'」へ移します。同じ名前がある場合は番号を付けます。'))return;try{transaction(function(next){Lib.removeGroup(next,current.id,target.id);});status('グループを削除し、保存した演出を移しました。');}catch(error){fail(error);}});
  $('saved-gallery').addEventListener('click',function(event){if(Panel.isBusy() || timelineBusy)return;var open=event.target.closest('[data-open-preset]'),manage=event.target.closest('[data-manage-preset]');
    if(open){var p=state.presets.find(function(p){return p.id===open.dataset.openPreset;});if(p){replace(p.project,p.id,p.name);status('「'+p.name+'」を開きました。変更は保存するまで元の演出に反映されません。');}}
    else if(manage){var item=state.presets.find(function(p){return p.id===manage.dataset.managePreset;});if(!item)return;managingId=item.id;$('manage-name').value=item.name;groupOptions($('manage-group'),item.groupId);$('manage-error').textContent='';$('manage-dialog').showModal();}
  });
  $('manage-form').addEventListener('submit',function(event){event.preventDefault();if(Panel.isBusy() || timelineBusy)return;try{transaction(function(next){Lib.editPreset(next,managingId,$('manage-name').value,$('manage-group').value);});$('manage-dialog').close();status('演出の名前と保存先を変更しました。');}catch(error){$('manage-error').textContent=error.message || String(error);}});
  $('delete-preset').addEventListener('click',function(){if(Panel.isBusy() || timelineBusy)return;var item=state.presets.find(function(p){return p.id===managingId;});if(!item || !window.confirm('「'+item.name+'」を削除しますか？'))return;try{transaction(function(next){Lib.removePreset(next,managingId);});$('manage-dialog').close();status('保存した演出を削除しました。');}catch(error){$('manage-error').textContent=error.message || String(error);}});
  document.querySelectorAll('[data-close-dialog]').forEach(function(button){button.addEventListener('click',function(){$(button.dataset.closeDialog).close();});});
  function commitFocusedInput(){var active=document.activeElement;if(!active || !$('editor-dialog').contains(active) || !active.matches('input,select'))return true;if(active.type==='number' && (active.value==='' || !Number.isFinite(Number(active.value)))){status('数値を入力してから保存してください。',true);return false;}var id=active.id,field=active.dataset.field,card=active.dataset.card;active.dispatchEvent(new Event('change',{bubbles:true}));var next=id?$(id):(field?Array.from(document.querySelectorAll('[data-field]')).find(function(el){return el.dataset.field===field && el.dataset.card===card;}):null);if(next)next.focus({preventScroll:true});return true;}
  document.addEventListener('keydown',function(event){if(!(event.ctrlKey || event.metaKey) || event.altKey)return;var key=event.key.toLowerCase();if(key==='f' && !document.querySelector('dialog[open]')){event.preventDefault();$('main-search').focus();$('main-search').select();return;}if(key!=='s' || $('sabu-dialog').open)return;event.preventDefault();if(Panel.isBusy() || $('sabu-picker-dialog').open)return;if($('save-dialog').open){$('save-form').requestSubmit();return;}if($('close-editor-dialog').open){saveAndClose();return;}if(!$('editor-dialog').open || !commitFocusedInput())return;if(event.shiftKey)openSave(true);else saveCurrent();});
  window.addEventListener('storage',function(event){if(event.key!==Lib.key || Panel.isBusy())return;try{state=Lib.load(localStorage);available=true;renderHome();}catch(error){fail(error);}});
  $('open-assets-library').addEventListener('click',function(){if(Panel.isBusy() || timelineBusy)return;$('assets-library-dialog').showModal();});
  renderHome();
  window.CardLibraryPanel={getState:function(){return Lib.clone(state);},openTemplate:function(mode){replace(Lib.baseProject(mode),null,'');},getEditingId:function(){return editingId;},commit:transaction,isAvailable:function(){return available;}};
}());
