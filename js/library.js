(function(root,factory){
  var Model=root.CardModel;
  if(!Model && typeof module==='object' && module.exports)Model=require('./model');
  var Timeline=root.CardTimelineModel;if(!Timeline && typeof window==='undefined' && typeof module==='object' && module.exports)Timeline=require('./timeline-model');
  var MediaGroups=root.CardMediaGroups;if(!MediaGroups && typeof window==='undefined' && typeof module==='object' && module.exports)MediaGroups=require('./media-groups');
  var api=factory(Model,Timeline,MediaGroups);
  if(typeof module==='object' && module.exports)module.exports=api;
  root.CardLibrary=api;
}(typeof window!=='undefined'?window:this,function(Model,Timeline,MediaGroups){
  'use strict';
  var key='cardReveal.library.v1',legacyKey='cardReveal.presets.v1';
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function id(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);}
  function name(value){value=String(value || '').trim();if(!value || value.length>40)throw new Error('名前を1〜40文字で入力してください。');return value;}
  function availableName(value,names){var original=String(value || '').trim().slice(0,40).trim() || '新しい演出',label=original,n=2;while(names.indexOf(label)>=0){var suffix=' ('+(n++)+')';label=original.slice(0,40-suffix.length)+suffix;}return label;}
  function group(state,groupId){var value=state.groups.find(function(g){return g.id===groupId;});if(!value)throw new Error('保存先のグループが見つかりません。');return value;}
  function validate(state){
    if(!state || state.version!==1 || !Array.isArray(state.groups) || !state.groups.length || !Array.isArray(state.presets))throw new Error('保存ライブラリを読み込めませんでした。元の保存データは変更していません。');
    var groups={},presets={};
    state.groups.forEach(function(g){if(!g || typeof g.id!=='string' || !g.id || groups[g.id])throw new Error('グループの保存データが重複しています。');name(g.name);groups[g.id]=true;});
    state.presets.forEach(function(p){if(!p || typeof p.id!=='string' || !p.id || presets[p.id] || !groups[p.groupId] || !p.project || typeof p.project!=='object')throw new Error('演出の保存データを確認してください。元の保存データは変更していません。');name(p.name);presets[p.id]=true;});
    if(state.assets!==undefined && !Array.isArray(state.assets))throw new Error('素材と配置の保存データを確認してください。');
    var assets={};(state.assets || []).forEach(function(asset){validatePlacement(asset);if(typeof asset.id!=='string' || !asset.id || assets[asset.id])throw new Error('素材と配置の保存データが重複しています。');assets[asset.id]=true;name(asset.name);});
    if(state.titles!==undefined && !Array.isArray(state.titles))throw new Error('テロップの保存データを確認してください。');
    var titles={};(state.titles || []).forEach(function(t){validateTitle(t);if(typeof t.id!=='string' || !t.id || titles[t.id] || !groups[t.groupId])throw new Error('テロップの保存先を確認してください。');titles[t.id]=true;name(t.name);});
    if(!groups[state.activeGroupId])throw new Error('選択中のグループが見つかりません。');
    if(state.mediaGroups!==undefined){if(!MediaGroups)throw new Error('素材グループの機能を読み込めませんでした。');MediaGroups.validate(state.mediaGroups);}
    return state;
  }
  function create(legacy){
    var state={version:1,activeGroupId:'main',groups:[{id:'main',name:'Main'}],presets:[],assets:[],titles:[],mediaGroups:MediaGroups.create()};
    if(legacy!==undefined && !Array.isArray(legacy))throw new Error('以前のプリセットを読み込めませんでした。保存データは変更していません。');
    (legacy || []).forEach(function(p){if(!p || typeof p.name!=='string' || !p.project || typeof p.project!=='object')throw new Error('以前のプリセットを確認してください。保存データは変更していません。');state.presets.push({id:id('preset'),groupId:'main',name:name(p.name),project:clone(p.project),thumbnail:null});});
    return validate(state);
  }
  function load(storage){
    var current=storage.getItem(key);
    if(current!==null){try{var value=JSON.parse(current);if(value && value.assets===undefined)value.assets=[];if(value && value.titles===undefined)value.titles=[];if(value && value.mediaGroups===undefined)value.mediaGroups=MediaGroups.create();return validate(value);}catch(error){throw new Error('保存ライブラリを読み込めませんでした。元データは変更していません。'+error.message);}}
    var old=storage.getItem(legacyKey),state;
    try{state=create(old===null?undefined:JSON.parse(old));}catch(error){throw new Error('以前のプリセットを移行できませんでした。元データは変更していません。'+error.message);}
    // Write the complete migrated state before the UI can make changes. Keep
    // the legacy key intact so failed migration and older releases are safe.
    storage.setItem(key,JSON.stringify(state));return state;
  }
  function save(storage,state){validate(state);storage.setItem(key,JSON.stringify(state));return state;}
  function addGroup(state,label){label=name(label);if(state.groups.some(function(g){return g.name===label;}))throw new Error('同じ名前のグループがあります。');var value={id:id('group'),name:label};state.groups.push(value);state.activeGroupId=value.id;return value;}
  function renameGroup(state,groupId,label){label=name(label);if(state.groups.some(function(g){return g.id!==groupId && g.name===label;}))throw new Error('同じ名前のグループがあります。');group(state,groupId).name=label;}
  function removeGroup(state,groupId,targetId){
    if(state.groups.length===1)throw new Error('最後のグループは削除できません。');
    group(state,groupId);group(state,targetId);if(groupId===targetId)throw new Error('別の移動先を選んでください。');
    var records=state.presets.concat(state.titles || []);records.forEach(function(p){if(p.groupId!==groupId)return;
      var original=p.name,label=original,n=2;
      while(records.some(function(other){return other.id!==p.id && other.groupId===targetId && other.name===label;})){var suffix=' ('+(n++)+')';label=original.slice(0,40-suffix.length)+suffix;}
      p.name=label;p.groupId=targetId;
    });state.groups=state.groups.filter(function(g){return g.id!==groupId;});if(state.activeGroupId===groupId)state.activeGroupId=targetId;
  }
  function savePreset(state,options){
    var label=name(options.name);group(state,options.groupId);
    var existing=options.id?state.presets.find(function(p){return p.id===options.id;}):null;
    if(options.id && !existing)throw new Error('保存した演出が見つかりません。');
    if(state.presets.some(function(p){return p.id!==options.id && p.groupId===options.groupId && p.name===label;}))throw new Error('このグループに同じ名前があります。別の名前で保存してください。');
    var project=Model.upgrade(clone(options.project)),errors=Model.validate(project);if(errors.length)throw new Error(errors.join(' / '));
    var thumbnail=typeof options.thumbnail==='string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(options.thumbnail) && options.thumbnail.length<=300000?options.thumbnail:null;
    var value={id:existing?existing.id:id('preset'),groupId:options.groupId,name:label,project:project,thumbnail:thumbnail};
    if(existing)state.presets[state.presets.indexOf(existing)]=value;else state.presets.push(value);
    state.activeGroupId=value.groupId;return value;
  }
  function editPreset(state,presetId,label,groupId){
    group(state,groupId);label=name(label);var p=state.presets.find(function(p){return p.id===presetId;});if(!p)throw new Error('保存した演出が見つかりません。');
    if(state.presets.some(function(other){return other.id!==presetId && other.groupId===groupId && other.name===label;}))throw new Error('移動先に同じ名前の演出があります。名前を変更してください。');p.name=label;p.groupId=groupId;state.activeGroupId=groupId;return p;
  }
  function removePreset(state,presetId){if(!state.presets.some(function(p){return p.id===presetId;}))throw new Error('保存した演出が見つかりません。');state.presets=state.presets.filter(function(p){return p.id!==presetId;});}
  function baseProject(mode){return Model.createProject(mode);}
  function validatePlacement(p){
    if(!p || typeof p.mediaPath!=='string' || !p.mediaPath.trim() || p.mediaPath.length>32768 || /^blob:/i.test(p.mediaPath))throw new Error('保存できる素材の場所を確認できません。Premiere内で素材を選び直してください。');
    if(p.mediaType!=='image' && p.mediaType!=='video')throw new Error('画像または動画を選んでください。');
    if(!Number.isFinite(p.referenceWidth) || p.referenceWidth<64 || p.referenceWidth>3840 || !Number.isFinite(p.referenceHeight) || p.referenceHeight<64 || p.referenceHeight>2160)throw new Error('配置の基準サイズを確認してください。');
    if(!Number.isFinite(p.mediaScale) || p.mediaScale<10 || p.mediaScale>400 || !Number.isFinite(p.mediaX) || Math.abs(p.mediaX)>p.referenceWidth*2 || !Number.isFinite(p.mediaY) || Math.abs(p.mediaY)>p.referenceHeight*2)throw new Error('大きさとX/Yの数値を確認してください。');
    if(!Number.isFinite(p.frameWidth) || p.frameWidth<16 || p.frameWidth>7680 || !Number.isFinite(p.frameHeight) || p.frameHeight<16 || p.frameHeight>7680)throw new Error('プレビューのサイズを確認してください。');return p;
  }
  function placementFrom(project,cardId){
    var c=project.cards.find(function(c){return c.id===cardId;});if(!c)throw new Error('保存する素材を選んでください。');
    var frame={width:project.cardWidth,height:project.cardHeight};
    if(project.mode==='highlight')frame=project.highlight;
    if(project.mode==='trapezoid')frame={width:project.width/3,height:project.height};
    if(project.mode==='half' || project.mode==='quad'){
      var index=project.cards.indexOf(c);
      if(index<Model.splitCount(project))frame=Model.splitBounds(Model.splitPolygons(project)[index]);
    }
    return validatePlacement({mediaPath:c.mediaPath,mediaType:c.mediaType,sourceName:c.name,mediaScale:c.mediaScale,mediaX:c.mediaX,mediaY:c.mediaY,referenceWidth:project.width,referenceHeight:project.height,frameWidth:frame.width,frameHeight:frame.height});
  }
  function savePlacement(state,options){
    var label=name(options.name),source=validatePlacement(options),existing=options.id?(state.assets || []).find(function(p){return p.id===options.id;}):null;
    if(options.id && !existing)throw new Error('保存した素材が見つかりません。別の名前で保存してください。');
    if((state.assets || []).some(function(p){return p.id!==options.id && p.name===label;}))throw new Error('素材と配置に同じ名前があります。別の名前で保存してください。');
    var thumbnail=typeof options.thumbnail==='string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(options.thumbnail) && options.thumbnail.length<=300000?options.thumbnail:null;
    var value={id:existing?existing.id:id('asset'),name:label,thumbnail:thumbnail};
    ['mediaPath','mediaType','sourceName','mediaScale','mediaX','mediaY','referenceWidth','referenceHeight','frameWidth','frameHeight'].forEach(function(k){value[k]=source[k];});
    if(!state.assets)state.assets=[];if(existing)state.assets[state.assets.indexOf(existing)]=value;else state.assets.push(value);return value;
  }
  function removePlacement(state,assetId){if(!(state.assets || []).some(function(a){return a.id===assetId;}))throw new Error('保存した素材が見つかりません。');state.assets=state.assets.filter(function(a){return a.id!==assetId;});}
  function applyPlacement(project,cardId,asset){
    validatePlacement(asset);var draft=Model.upgrade(clone(project)),target=draft.cards.find(function(c){return c.id===cardId;});if(!target)throw new Error('適用先の素材を選んでください。');
    target.mediaPath=asset.mediaPath;target.mediaType=asset.mediaType;target.name=String(asset.sourceName || asset.name || '素材と配置の素材').slice(0,100);target.mediaScale=asset.mediaScale;target.mediaX=asset.mediaX*project.width/asset.referenceWidth;target.mediaY=asset.mediaY*project.height/asset.referenceHeight;
    var errors=Model.validate(draft);if(errors.length)throw new Error(errors.join(' / '));var card=project.cards.find(function(c){return c.id===cardId;});['mediaPath','mediaType','name','mediaScale','mediaX','mediaY'].forEach(function(k){card[k]=target[k];});return project;
  }
  function validateTitle(t){var trial=t && t.sourceType==='timeline';if(!t || (t.sourceType!==undefined && t.sourceType!=='timeline') || typeof t.templatePath!=='string' || !(trial?/\.prproj$/i:/\.mogrt$/i).test(t.templatePath) || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(t.templatePath) || /[\u0000-\u001f]/.test(t.templatePath) || t.templatePath.length>32768)throw new Error(trial?'試験テロップの保存先を確認してください。':'登録する.mogrtファイルを選んでください。');if(t.videoTrack!=='auto' && (!Number.isInteger(t.videoTrack) || t.videoTrack<0 || t.videoTrack>999))throw new Error('挿入先のビデオトラックを選んでください。');if(trial){if(!Timeline)throw new Error('試験登録モデルを読み込めません。パネルを開き直してください。');Timeline.validateTemplate(t);}return t;}
  function saveTitle(state,options){var label=name(options.name);group(state,options.groupId);validateTitle(options);var existing=options.id?(state.titles || []).find(function(t){return t.id===options.id;}):null;if(options.id && !existing)throw new Error('保存したテロップが見つかりません。');if(state.presets.concat(state.titles || []).some(function(p){return p.id!==options.id && p.groupId===options.groupId && p.name===label;}))throw new Error('このグループに同じ名前があります。別の名前で保存してください。');var value={id:existing?existing.id:id('title'),groupId:options.groupId,name:label,templatePath:options.templatePath,sourceName:String(options.sourceName || '').slice(0,200),videoTrack:options.videoTrack};if(options.sourceType==='timeline'){value.sourceType='timeline';['sequenceId','width','height','timebase','durationTicks'].forEach(function(k){value[k]=options[k];});}if(!state.titles)state.titles=[];if(existing)state.titles[state.titles.indexOf(existing)]=value;else state.titles.push(value);state.activeGroupId=value.groupId;return value;}
  function removeTitle(state,titleId){if(!(state.titles || []).some(function(t){return t.id===titleId;}))throw new Error('保存したテロップが見つかりません。');state.titles=state.titles.filter(function(t){return t.id!==titleId;});}
  return {key:key,legacyKey:legacyKey,clone:clone,create:create,load:load,save:save,validate:validate,addGroup:addGroup,renameGroup:renameGroup,removeGroup:removeGroup,savePreset:savePreset,editPreset:editPreset,removePreset:removePreset,baseProject:baseProject,validatePlacement:validatePlacement,placementFrom:placementFrom,savePlacement:savePlacement,removePlacement:removePlacement,applyPlacement:applyPlacement,availableName:availableName,validateTitle:validateTitle,saveTitle:saveTitle,removeTitle:removeTitle};
}));
