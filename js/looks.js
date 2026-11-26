(function(root,factory){
  var model=root.CardModel;
  if(!model && typeof module==='object' && module.exports)model=require('./model');
  var api=factory(model);
  if(typeof module==='object' && module.exports)module.exports=api;
  root.CardLooks=api;
}(typeof window!=='undefined'?window:this,function(Model){
  'use strict';
  var catalog=[
    {id:'cards-row',mode:'cards',kind:'row',name:'横一列',description:'カードを横にすっきり整列',colors:['#4ea1ff','#ef9b35']},
    {id:'cards-grid',mode:'cards',kind:'grid',name:'グリッド',description:'枚数に合わせて複数段に整列',colors:['#4ea1ff','#ef9b35']},
    {id:'split-standard',mode:'trapezoid',kind:'split',name:'標準の3分割',description:'8度の斜め境界',angle:8,colors:['#e5b64f','#53a2af','#a084c6']},
    {id:'split-soft',mode:'trapezoid',kind:'split',name:'ゆるやかな3分割',description:'3度のゆるやかな境界',angle:3,colors:['#e5b64f','#53a2af','#a084c6']},
    {id:'split-straight',mode:'trapezoid',kind:'split',name:'まっすぐ3分割',description:'垂直の境界で均等に',angle:0,colors:['#e5b64f','#53a2af','#a084c6']},
    {id:'highlight-yellow',mode:'highlight',kind:'highlight',name:'イエローグロー',description:'黄色い発光と白い縁',colors:['#ffe600','#ffffff']},
    {id:'highlight-cyan',mode:'highlight',kind:'highlight',name:'シアンネオン',description:'青い発光と白い縁',colors:['#28c7ff','#ffffff']},
    {id:'highlight-white',mode:'highlight',kind:'highlight',name:'ホワイトライン',description:'発光のないシンプルな白枠',colors:['#ffffff']}
  ];
  function list(mode){return catalog.filter(function(item){return item.mode===mode;}).map(function(item){var copy=Object.assign({},item);copy.colors=item.colors.slice();return copy;});}
  function apply(project,id){
    var spec=catalog.find(function(item){return item.id===id;});
    if(!spec)throw new Error('選択した見た目が見つかりません。');
    // Plan changes before touching the user's project. Failed layout choices
    // must not discard media, hand-drawn shapes or custom timing.
    var draft=Model.upgrade(JSON.parse(JSON.stringify(project)));
    Model.setMode(draft,spec.mode);
    if(spec.mode==='cards'){
      Model.arrange(draft,spec.kind);
      var end=Math.max.apply(null,draft.cards.map(function(c){return Math.max(c.dropAt+draft.dropDuration,c.flipAt+draft.flipDuration);}));
      draft.duration=Math.max(draft.duration,Math.ceil(end));
    }else if(spec.mode==='trapezoid')draft.trapezoid.angle=spec.angle;
    else {
      var layers;
      if(spec.id==='highlight-white'){
        layers=[Model.highlightLayer('白い枠','#ffffff',4,0,0,1)];
      }else{
        var cyan=spec.id==='highlight-cyan',color=spec.colors[0];
        layers=[Model.highlightLayer(cyan?'青い光':'外側の光',color,12,30,10,.85),
          Model.highlightLayer(cyan?'シアンの枠':'黄色の枠',color,8,4,6,1),
          Model.highlightLayer('白い縁','#ffffff',3,0,1,1)];
      }
      draft.highlight.layers=layers;
    }
    var errors=Model.validate(draft);if(errors.length)throw new Error('見た目を適用できません。'+errors.join(' / '));
    Model.upgrade(project);project.mode=draft.mode;project.duration=draft.duration;
    if(spec.mode==='cards'){
      project.cardWidth=draft.cardWidth;project.cardHeight=draft.cardHeight;
      project.cards.forEach(function(c,i){c.x=draft.cards[i].x;c.y=draft.cards[i].y;});
    }else if(spec.mode==='trapezoid'){
      while(project.cards.length<draft.cards.length)project.cards.push(draft.cards[project.cards.length]);
      project.trapezoid.angle=draft.trapezoid.angle;
    }else project.highlight.layers=draft.highlight.layers;
    return project;
  }
  return {list:list,apply:apply};
}));
