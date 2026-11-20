'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Model=require('../js/model'),Looks=require('../js/looks');
function sourceSettings(p){return p.cards.map(c=>({id:c.id,path:c.mediaPath,type:c.mediaType,scale:c.mediaScale,x:c.mediaX,y:c.mediaY,offset:c.mediaOffset,dropAt:c.dropAt,flipAt:c.flipAt}));}
function project(){const p=Model.createProject();p.cards.forEach((c,i)=>{c.mediaPath='C:/素材/'+i+'.png';c.mediaType='image';c.mediaX=i*13;c.mediaY=i*-7;c.mediaScale=100+i*25;c.mediaOffset=i*.5;});return p;}

test('look catalog is mode-specific and caller mutations cannot corrupt it',()=>{
 assert.equal(Looks.list('cards').length,2);assert.equal(Looks.list('trapezoid').length,3);assert.equal(Looks.list('highlight').length,3);assert.deepEqual(Looks.list('unknown'),[]);
 const first=Looks.list('cards')[0];first.name='changed';first.colors[0]='#000000';assert.equal(Looks.list('cards')[0].name,'横一列');assert.notEqual(Looks.list('cards')[0].colors[0],'#000000');
});
test('card looks keep each assigned material and timing while arranging frames',()=>{
 const p=project(),settings=sourceSettings(p),objects=p.cards.slice();
 Looks.apply(p,'cards-grid');assert.equal(p.cards[0],objects[0]);assert.deepEqual(sourceSettings(p),settings);assert.deepEqual(Model.validate(p),[]);assert.ok(p.cards[2].y>p.cards[0].y);
 Looks.apply(p,'cards-row');assert.deepEqual(sourceSettings(p),settings);assert.ok(p.cards.every(c=>c.y===p.cards[0].y));
});
test('split looks change only slope and retain sources, border style and animation',()=>{
 const p=project(),settings=sourceSettings(p);Model.setMode(p,'trapezoid');p.trapezoid.borderColor='#0044ff';p.trapezoid.interval=.6;
 for(const [id,angle] of [['split-standard',8],['split-soft',3],['split-straight',0]]){Looks.apply(p,id);assert.equal(p.trapezoid.angle,angle);assert.equal(p.trapezoid.borderColor,'#0044ff');assert.equal(p.trapezoid.interval,.6);assert.deepEqual(sourceSettings(p),settings);assert.deepEqual(Model.validate(p),[]);}
});
test('highlight looks preserve hand-drawn shape, source and frame transforms',()=>{
 const p=project();Model.setMode(p,'highlight');p.highlight.shape='polygon';p.highlight.points[1].y=.15;p.highlight.x=740;p.highlight.rotation=-8;
 const source=sourceSettings(p),shape=JSON.stringify(p.highlight.points),bounds=[p.highlight.x,p.highlight.y,p.highlight.width,p.highlight.height,p.highlight.rotation];
 Looks.apply(p,'highlight-cyan');assert.equal(p.highlight.layers[0].color,'#28c7ff');assert.equal(p.highlight.layers.length,3);
 Looks.apply(p,'highlight-white');assert.equal(p.highlight.layers.length,1);assert.equal(p.highlight.layers[0].glow,0);assert.equal(p.highlight.layers[0].color,'#ffffff');
 Looks.apply(p,'highlight-yellow');assert.equal(p.highlight.layers.length,3);assert.equal(p.highlight.layers[0].color,'#ffe600');
 assert.equal(JSON.stringify(p.highlight.points),shape);assert.deepEqual([p.highlight.x,p.highlight.y,p.highlight.width,p.highlight.height,p.highlight.rotation],bounds);assert.deepEqual(sourceSettings(p),source);assert.deepEqual(Model.validate(p),[]);
});
test('invalid look choices fail without mutating the project',()=>{
 const p=project(),before=JSON.stringify(p);assert.throws(()=>Looks.apply(p,'missing'),/見つかりません/);assert.equal(JSON.stringify(p),before);
 p.width=64;p.height=64;Model.resizeCards(p,12);const small=JSON.stringify(p);assert.throws(()=>Looks.apply(p,'cards-row'),/大きく/);assert.equal(JSON.stringify(p),small);
});
test('CEP mixed context uses the browser model without a relative Node require',()=>{
 const window={CardModel:Model},module={exports:{}};
 const context=vm.createContext({window,module,require:()=>{throw new Error('Relative Node require must not run');}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/looks.js'),'utf8'),context);
 assert.equal(window.CardLooks,module.exports);assert.equal(window.CardLooks.list('highlight').length,3);const p=project();window.CardLooks.apply(p,'split-soft');assert.equal(p.mode,'trapezoid');assert.equal(p.trapezoid.angle,3);
});
