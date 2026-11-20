'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Lib=require('../js/library'),Model=require('../js/model');
function storage(initial={}){const values=new Map(Object.entries(initial));return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),values};}
function preset(state,groupId,name='演出'){return Lib.savePreset(state,{groupId,name,project:Model.createProject()});}

test('legacy preset migration retains complete projects and the original backup',()=>{
 const project=Model.createProject();project.cards[0].mediaPath='C:/素材/ボス.png';project.cards[0].mediaScale=135;project.highlight.points[1].y=.08;
 const legacy=JSON.stringify([{name:'ボス紹介',project}]),s=storage({[Lib.legacyKey]:legacy}),state=Lib.load(s);
 assert.equal(state.groups[0].name,'Main');assert.equal(state.presets[0].groupId,'main');assert.deepEqual(state.presets[0].project,project);assert.equal(s.getItem(Lib.legacyKey),legacy);
 assert.deepEqual(Lib.load(s),state,'migration happens once with stable identities');
});
test('corrupt or future libraries and failed migrations never replace saved data',()=>{
 for(const value of ['broken',JSON.stringify({version:99,groups:[],presets:[]})]){const s=storage({[Lib.key]:value});assert.throws(()=>Lib.load(s),/元データ/);assert.equal(s.getItem(Lib.key),value);}
 const old='[{"name":"missing project"}]',s=storage({[Lib.legacyKey]:old});assert.throws(()=>Lib.load(s),/移行/);assert.equal(s.getItem(Lib.key),null);assert.equal(s.getItem(Lib.legacyKey),old);
 const full=storage({[Lib.legacyKey]:JSON.stringify([{name:'old',project:Model.createProject()}])});full.setItem=()=>{throw new Error('quota');};assert.throws(()=>Lib.load(full),/quota/);assert.equal(full.getItem(Lib.key),null);assert.ok(full.getItem(Lib.legacyKey));
});
test('groups isolate presets and duplicate names cannot overwrite another preset',()=>{
 const state=Lib.create(),a=preset(state,'main','同じ名前'),g=Lib.addGroup(state,'ゲーム実況'),b=preset(state,g.id,'同じ名前');
 assert.notEqual(a.id,b.id);assert.throws(()=>preset(state,'main','同じ名前'),/同じ名前/);assert.equal(state.presets.length,2);
 assert.throws(()=>Lib.addGroup(state,'ゲーム実況'),/同じ名前/);Lib.renameGroup(state,g.id,'ボス戦');assert.equal(state.groups[1].name,'ボス戦');assert.equal(state.presets[1].groupId,g.id);
});
test('editing a saved copy leaves its original intact until an explicit update',()=>{
 const state=Lib.create(),p=preset(state,'main'),before=Lib.clone(p.project),draft=Lib.clone(p.project);draft.cards[0].mediaX=220;draft.highlight.rotation=15;
 assert.deepEqual(p.project,before);const updated=Lib.savePreset(state,{id:p.id,name:p.name,groupId:'main',project:draft});assert.equal(updated.id,p.id);assert.equal(state.presets.length,1);assert.equal(updated.project.cards[0].mediaX,220);
 draft.cards[0].mediaX=330;assert.equal(updated.project.cards[0].mediaX,220,'saved snapshots do not alias mutable drafts');
 const copy=Lib.savePreset(state,{name:'別名',groupId:'main',project:updated.project});assert.notEqual(copy.id,p.id);assert.equal(state.presets.length,2);
});
test('moving and removing a group preserves its presets and forbids deleting the last group',()=>{
 const state=Lib.create(),g=Lib.addGroup(state,'Extra'),p=preset(state,g.id);Lib.removeGroup(state,g.id,'main');assert.equal(state.presets[0].id,p.id);assert.equal(state.presets[0].groupId,'main');assert.equal(state.activeGroupId,'main');assert.throws(()=>Lib.removeGroup(state,'main','main'),/最後/);
 const h=Lib.addGroup(state,'移動先');Lib.editPreset(state,p.id,'名前変更',h.id);assert.equal(state.presets[0].groupId,h.id);assert.equal(state.presets[0].name,'名前変更');Lib.removePreset(state,p.id);assert.equal(state.presets.length,0);
});
test('invalid projects and unsafe thumbnail strings cannot contaminate the library',()=>{
 const state=Lib.create(),invalid=Model.createProject();invalid.cards[0].mediaScale=-1;assert.throws(()=>Lib.savePreset(state,{groupId:'main',name:'bad',project:invalid}));assert.equal(state.presets.length,0);
 const p=Lib.savePreset(state,{groupId:'main',name:'safe',project:Model.createProject(),thumbnail:'" onerror="alert(1)'});assert.equal(p.thumbnail,null);
 const broken=Lib.clone(state);broken.presets[0].groupId='missing';assert.throws(()=>Lib.validate(broken));
});
test('storage quota failures leave the committed library intact',()=>{
 const s=storage(),state=Lib.load(s),before=s.getItem(Lib.key),next=Lib.clone(state);Lib.addGroup(next,'new');s.setItem=()=>{throw new Error('quota');};assert.throws(()=>Lib.save(s,next),/quota/);assert.equal(s.getItem(Lib.key),before);assert.equal(state.groups.length,1);
});
test('each base template is a fresh editable project without saved customizations',()=>{
 for(const mode of ['cards','trapezoid','highlight']){const a=Lib.baseProject(mode),b=Lib.baseProject(mode);assert.equal(a.mode,mode);assert.deepEqual(Model.validate(a),[]);a.cards[0].mediaPath='private.png';a.highlight.layers[0].color='#000000';assert.equal(b.cards[0].mediaPath,'');assert.notEqual(b.highlight.layers[0].color,'#000000');}
});
test('group deletion disambiguates colliding names without losing either project',()=>{
 const state=Lib.create(),original=preset(state,'main','同じ名前'),group=Lib.addGroup(state,'Extra'),moved=preset(state,group.id,'同じ名前');
 moved.project.cards[0].mediaX=213;Lib.removeGroup(state,group.id,'main');assert.equal(state.presets.length,2);assert.equal(state.presets.find(p=>p.id===original.id).name,'同じ名前');const copy=state.presets.find(p=>p.id===moved.id);assert.equal(copy.name,'同じ名前 (2)');assert.equal(copy.project.cards[0].mediaX,213);
 Lib.savePreset(state,{id:copy.id,name:copy.name,groupId:'main',project:copy.project});assert.equal(state.presets.length,2);
});
test('CEP mixed context uses the existing browser model without a relative Node require',()=>{
 const window={CardModel:Model},module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../js/library'),'utf8'),{window,module,require:()=>{throw new Error('relative require');}});assert.equal(window.CardLibrary,module.exports);assert.equal(window.CardLibrary.baseProject('highlight').mode,'highlight');
});

test('SABU stores only source media and size/XY, independently of MAIN groups and effects',()=>{
 const state=Lib.create(),project=Model.createProject(),c=project.cards[0];c.mediaPath='C:/素材/ボス.png';c.mediaType='image';c.mediaScale=145;c.mediaX=120;c.mediaY=-50;project.highlight.layers[0].color='#28c7ff';
 const asset=Lib.savePlacement(state,{...Lib.placementFrom(project,c.id),name:'右寄せ'});assert.equal(state.presets.length,0);assert.equal(state.assets.length,1);assert.equal(asset.mediaPath,c.mediaPath);assert.equal(asset.mediaScale,145);assert.equal(asset.project,undefined);assert.equal(asset.highlight,undefined);assert.equal(asset.flipAt,undefined);
 const g=Lib.addGroup(state,'Another');Lib.removeGroup(state,g.id,'main');assert.equal(state.assets[0].id,asset.id);const s=storage();Lib.save(s,state);assert.deepEqual(Lib.load(s).assets[0],asset);
});
test('SABU applies to a selected source in all modes without changing frame, animation, layers or other sources',()=>{
 const base=Model.createProject(),c=base.cards[0];c.mediaPath='C:/動画/素材.mp4';c.mediaType='video';c.mediaScale=135;c.mediaX=96;c.mediaY=-54;const asset=Lib.placementFrom(base,c.id);
 for(const mode of ['cards','trapezoid','highlight']){const target=Lib.baseProject(mode),index=mode==='cards'?1:0,before=Lib.clone(target);Lib.applyPlacement(target,target.cards[index].id,asset);const expected=Lib.clone(before);Object.assign(expected.cards[index],{mediaPath:asset.mediaPath,mediaType:asset.mediaType,name:c.name,mediaScale:135,mediaX:96,mediaY:-54});assert.deepEqual(target,expected);assert.deepEqual(Model.validate(target),[]);}
 const portrait=Lib.baseProject('highlight');portrait.width=1080;portrait.height=1920;Lib.applyPlacement(portrait,portrait.cards[0].id,asset);assert.equal(portrait.cards[0].mediaX,54);assert.equal(portrait.cards[0].mediaY,-96);
});
test('invalid SABU data, duplicate names and failed applies leave existing work intact',()=>{
 const state=Lib.create(),p=Model.createProject();p.cards[0].mediaPath='C:/image.png';p.cards[0].mediaType='image';const a=Lib.placementFrom(p,p.cards[0].id);const saved=Lib.savePlacement(state,{...a,name:'Image'});assert.throws(()=>Lib.savePlacement(state,{...a,name:'Image'}),/同じ名前/);assert.equal(state.assets.length,1);
 const before=JSON.stringify(p);assert.throws(()=>Lib.applyPlacement(p,p.cards[0].id,{...a,mediaScale:0}));assert.equal(JSON.stringify(p),before);assert.throws(()=>Lib.savePlacement(state,{...a,name:'bad',mediaPath:'blob:temporary'}));
 Lib.savePreset(state,{name:'Main effect',groupId:'main',project:p});Lib.removePlacement(state,saved.id);assert.equal(state.assets.length,0);assert.equal(state.presets[0].project.cards[0].mediaPath,'C:/image.png');
});
test('existing libraries without SABU get an empty asset list without replacing their presets',()=>{
 const state=Lib.create();preset(state,'main');delete state.assets;const raw=JSON.stringify(state),s=storage({[Lib.key]:raw});const upgraded=Lib.load(s);assert.equal(upgraded.assets.length,0);assert.deepEqual(upgraded.presets,state.presets);assert.equal(s.getItem(Lib.key),raw);
});
