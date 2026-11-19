'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/model');

test('timing: card remains off-screen, lands, reveals, then advances video', () => {
  const p = model.createProject(), c = p.cards[0];
  c.dropAt = 0.5; c.flipAt = 2; c.mediaOffset = 4;
  assert.equal(model.pose(p, c, 0).visible, false);
  assert.ok(model.pose(p, c, c.dropAt).y + p.cardHeight / 2 < 0);
  assert.equal(model.pose(p, c, c.dropAt + p.dropDuration).y, c.y);
  const edge = model.pose(p, c, c.flipAt + p.flipDuration / 2);
  assert.ok(edge.width <= 2.00001);
  assert.equal(edge.front, true);
  assert.equal(edge.mediaTime, 4);
  const end = model.pose(p, c, 3.3);
  assert.equal(end.front, true);
  assert.equal(end.width, p.cardWidth);
  assert.ok(Math.abs(end.mediaTime - 5) < 1e-7);
});

test('reordering changes reveal slots without changing assigned media or position', () => {
  const p = model.createProject(), first = p.cards[0], second = p.cards[1], last = p.cards[2];
  first.mediaPath = 'C:\\test\\boss.mp4'; first.mediaType = 'video';
  const slots = p.cards.map(c => c.flipAt), position = {x:first.x,y:first.y};
  model.reorder(p, 0, 2);
  assert.equal(p.cards[0], second);
  assert.equal(p.cards[1], last);
  assert.equal(p.cards[2], first);
  assert.deepEqual(p.cards.map(c => c.flipAt), slots);
  assert.equal(first.mediaPath, 'C:\\test\\boss.mp4');
  assert.deepEqual({x:first.x,y:first.y}, position);
});

test('all supported card counts fit the frame and have valid timing', () => {
  for (let n=1;n<=12;n++) {
    const p = model.createProject(); model.resizeCards(p,n);
    assert.equal(p.cards.length, n);
    assert.deepEqual(model.validate(p), []);
    for (const c of p.cards) {
      assert.ok(c.x-p.cardWidth/2>=0 && c.x+p.cardWidth/2<=p.width);
      assert.ok(c.y-p.cardHeight/2>=0 && c.y+p.cardHeight/2<=p.height);
    }
  }
});

test('bad imported JSON and truncated animations are rejected', () => {
  for (const p of [null, [], {}, {cards:[null]}]) assert.ok(model.validate(p).length);
  const p = model.createProject(); p.cards[0].flipAt = p.duration;
  assert.ok(model.validate(p).some(e=>/終わる/.test(e)));
  p.cards[0].flipAt = 1.8; p.cards[0].mediaPath = 'C:\\test.png';
  assert.ok(model.validate(p).some(e=>/種類/.test(e)));
});

test('reveal order remains valid when a late-entering card moves first', () => {
  const p = model.createProject(); model.resizeCards(p, 12);
  const lastId = p.cards[11].id;
  model.reorder(p, 11, 0);
  assert.equal(p.cards[0].id, lastId);
  assert.deepEqual(model.validate(p), []);
  assert.ok(p.cards.every((c, i, all) => !i || c.flipAt >= all[i-1].flipAt));
  p.cards[0].id = 'x\" onclick=\"evil';
  assert.ok(model.validate(p).some(e => /ID/.test(e)));
});

test('changing count preserves existing manual placement and card size', () => {
  const p = model.createProject(); p.cards[0].x = 401; p.cards[0].y = 389;
  const before = JSON.parse(JSON.stringify(p.cards)), size = [p.cardWidth,p.cardHeight];
  model.resizeCards(p, 8);
  assert.deepEqual(p.cards.slice(0,3), before);
  assert.deepEqual([p.cardWidth,p.cardHeight], size);
  model.resizeCards(p, 2);
  assert.deepEqual(p.cards, before.slice(0,2));
});

test('explicit layouts fit all cards and centering touches only the selected card', () => {
  for (const layout of ['row','grid']) {
    const p = model.createProject(); model.resizeCards(p,12); model.arrange(p,layout);
    assert.deepEqual(model.validate(p),[]);
    for (const c of p.cards) assert.ok(c.x-p.cardWidth/2>=0 && c.x+p.cardWidth/2<=p.width && c.y-p.cardHeight/2>=0 && c.y+p.cardHeight/2<=p.height);
    for (let i=0;i<p.cards.length;i++) for (let j=0;j<i;j++) assert.ok(Math.abs(p.cards[i].x-p.cards[j].x)>=p.cardWidth || Math.abs(p.cards[i].y-p.cards[j].y)>=p.cardHeight);
  }
  const p = model.createProject(), otherX = p.cards[1].x;
  model.arrange(p,'center',p.cards[0].id);
  assert.equal(p.cards[0].x,p.width/2); assert.equal(p.cards[0].y,p.height/2); assert.equal(p.cards[1].x,otherX);
});

test('sequence timing respects late entrances and rejects overflow without mutating', () => {
  const p = model.createProject(); p.cards[2].dropAt=4;
  model.sequence(p,0,0.5);
  assert.deepEqual(p.cards.map(c=>c.flipAt),[4,4.5,5]);
  assert.deepEqual(model.validate(p),[]);
  const snapshot=JSON.stringify(p);
  assert.throws(()=>model.sequence(p,119,1),/120/);
  assert.equal(JSON.stringify(p),snapshot);
});

test('trapezoid boundaries partition the frame and remain shared without crossing in portrait or landscape', () => {
  for(const dimensions of [[1920,1080],[1080,1920]]) for(const angle of [-20,0,8,20]) {
    const p=model.createProject(); p.mode='trapezoid'; p.trapezoid.angle=angle;
    p.width=dimensions[0]; p.height=dimensions[1];
    const polygons=model.splitPolygons(p);
    assert.deepEqual(polygons[0][1],polygons[1][0]);
    assert.deepEqual(polygons[0][2],polygons[1][3]);
    assert.deepEqual(polygons[1][1],polygons[2][0]);
    assert.deepEqual(polygons[1][2],polygons[2][3]);
    const area=polygons.reduce((sum,poly)=>sum+Math.abs(poly.reduce((a,pt,i)=>a+pt.x*poly[(i+1)%poly.length].y-poly[(i+1)%poly.length].x*pt.y,0))/2,0);
    assert.ok(Math.abs(area-p.width*p.height)<1e-6);
    assert.ok(polygons.flat().every(pt=>pt.x>=0 && pt.x<=p.width && pt.y>=0 && pt.y<=p.height));
    assert.ok(polygons[1][0].x<polygons[1][1].x);
    assert.ok(polygons[1][3].x<polygons[1][2].x);
  }
});

test('a reorder which cannot fit within 120 seconds leaves the project untouched', () => {
  const p=model.createProject(); p.duration=120; p.cards[2].dropAt=118; p.cards[2].flipAt=119;
  assert.deepEqual(model.validate(p),[]);
  const before=JSON.stringify(p);
  assert.throws(()=>model.reorder(p,2,0),/120/);
  assert.equal(JSON.stringify(p),before);
});

test('split slides stagger and start video when each panel enters at up to 120fps', () => {
  const p=model.createProject(); model.setMode(p,'trapezoid'); p.fps=120;
  assert.deepEqual(model.validate(p),[]);
  const middle=model.splitPose(p,1,0.2);
  assert.equal(middle.visible,false); assert.equal(middle.offsetY,-p.height);
  const landed=model.splitPose(p,1,1.05);
  assert.equal(landed.offsetY,0); assert.ok(Math.abs(landed.mediaTime-.8)<1e-8);
  p.trapezoid.interval=10; p.duration=2;
  assert.ok(model.validate(p).some(e=>/登場し終わる/.test(e)));
});

test('legacy project upgrades preserve saved settings and split mode preserves extra cards', () => {
  const p=model.createProject(); delete p.mode; delete p.trapezoid; delete p.backgroundMode; delete p.backgroundColor;
  const first=JSON.stringify(p.cards[0]); model.upgrade(p);
  assert.equal(p.mode,'cards'); assert.equal(p.backgroundMode,'transparent'); assert.equal(JSON.stringify(p.cards[0]),first);
  model.resizeCards(p,7); const ids=p.cards.map(c=>c.id); model.setMode(p,'trapezoid'); model.setMode(p,'cards');
  assert.deepEqual(p.cards.map(c=>c.id),ids);
});

test('media transforms use the whole original image before the fixed frame clips it', () => {
  const c=model.createProject().cards[0];
  assert.deepEqual(model.mediaRect(c,200,100,100,100),{x:-50,y:0,width:200,height:100});
  c.mediaScale=50;
  assert.deepEqual(model.mediaRect(c,200,100,100,100),{x:0,y:25,width:100,height:50});
  c.mediaX=20; c.mediaY=-10;
  assert.deepEqual(model.mediaRect(c,200,100,100,100),{x:20,y:15,width:100,height:50});
  c.mediaScale=200; c.mediaX=40; c.mediaY=-30;
  assert.deepEqual(model.mediaRect(c,200,100,100,100),{x:-110,y:-80,width:400,height:200});
  assert.deepEqual(model.mediaRect(c,0,0,100,100),{x:0,y:0,width:0,height:0});
});

test('legacy media settings get centered cover defaults and edited values survive JSON and mode changes', () => {
  const p=model.createProject(); delete p.cards[0].mediaScale; delete p.cards[0].mediaX; delete p.cards[0].mediaY;
  assert.deepEqual(model.validate(p),[]);
  assert.deepEqual(model.mediaRect(p.cards[0],100,200,100,100),{x:0,y:-50,width:100,height:200});
  model.upgrade(p);
  assert.deepEqual([p.cards[0].mediaScale,p.cards[0].mediaX,p.cards[0].mediaY],[100,0,0]);
  p.cards[0].mediaScale=75;p.cards[0].mediaX=-23;p.cards[0].mediaY=41;
  const restored=model.upgrade(JSON.parse(JSON.stringify(p)));
  model.reorder(restored,0,2);model.setMode(restored,'trapezoid');model.setMode(restored,'cards');
  assert.deepEqual(restored.cards.map(c=>[c.mediaScale,c.mediaX,c.mediaY]),[[100,0,0],[100,0,0],[75,-23,41]]);
});

test('invalid media size and positions cannot be exported or loaded silently', () => {
  for(const [key,value] of [['mediaScale',0],['mediaScale',401],['mediaScale','150'],['mediaX',Infinity],['mediaX',3841],['mediaY',-2161]]) {
    const p=model.createProject();p.cards[0][key]=value;
    assert.ok(model.validate(p).some(e=>/素材の(大きさ|X位置|Y位置)/.test(e)),key);
  }
});

test('highlight mode preserves other cards and works independently of reveal timings', () => {
  const p=model.createProject();model.resizeCards(p,6);
  const cards=JSON.stringify(p.cards);
  model.setMode(p,'highlight');p.duration=.5;
  assert.deepEqual(model.validate(p),[]);
  assert.equal(JSON.stringify(p.cards),cards);
  p.duration=20;model.setMode(p,'cards');
  assert.equal(JSON.stringify(p.cards),cards);
  assert.equal(p.highlight.layers.length,3);
});

test('highlight layers are independent, ordered and bounded without changing material settings', () => {
  const p=model.createProject();model.setMode(p,'highlight');
  const originalSource=JSON.stringify(p.cards[0]),first=p.highlight.layers[0];
  const id=model.addHighlightLayer(p),added=p.highlight.layers.find(l=>l.id===id);
  added.color='#00ccff';added.glow=12;added.width=2;
  model.reorderHighlightLayer(p,3,0);
  assert.equal(p.highlight.layers[0],added);assert.equal(p.highlight.layers[1],first);
  assert.equal(first.color,'#ffe600');assert.equal(JSON.stringify(p.cards[0]),originalSource);
  while(p.highlight.layers.length<12)model.addHighlightLayer(p);
  const snapshot=JSON.stringify(p);
  assert.throws(()=>model.addHighlightLayer(p),/12/);assert.equal(JSON.stringify(p),snapshot);
  p.highlight.layers=[];assert.deepEqual(model.validate(p),[]);
});

test('polygon handles support concavity, add/remove points and reject crossings', () => {
  const p=model.createProject(),h=p.highlight;
  h.shape='polygon';h.points=[{x:0,y:0},{x:1,y:0},{x:.6,y:.5},{x:1,y:1},{x:0,y:1}];
  assert.equal(model.highlightPolygonValid(h.points),true);
  const before=JSON.stringify(h.points),index=model.addHighlightPoint(h,0);
  assert.equal(index,1);assert.equal(h.points.length,6);assert.equal(model.highlightPolygonValid(h.points),true);
  model.removeHighlightPoint(h,index);assert.equal(JSON.stringify(h.points),before);
  assert.equal(model.highlightPolygonValid([{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}]),false);
  h.points=[{x:0,y:0},{x:1,y:0},{x:.5,y:1}];
  assert.throws(()=>model.removeHighlightPoint(h,0),/3個/);
  h.points[0].x=-.1;assert.equal(model.highlightPolygonValid(h.points),false);
});

test('legacy projects receive fresh highlight defaults and saved layers survive upgrade', () => {
  const old=model.createProject();old.version=3;delete old.highlight;
  old.cards[0].mediaScale=135;model.upgrade(old);
  assert.equal(old.version,4);assert.equal(old.cards[0].mediaScale,135);
  old.highlight.shape='polygon';old.highlight.layers[1].color='#aa00ff';old.highlight.rotation=-7;
  const restored=model.upgrade(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(restored.highlight,old.highlight);
  const fresh=model.createProject();assert.notEqual(fresh.highlight.layers[1].color,'#aa00ff');
});

test('highlight geometry and style validation rejects invalid settings', () => {
  for(const [key,value] of [['width',0],['rotation',181],['radius',-1],['shape','circle']]) {
    const p=model.createProject();p.mode='highlight';p.highlight[key]=value;
    assert.ok(model.validate(p).length,key);
  }
  for(const [key,value] of [['width',81],['glow',-1],['opacity',1.1],['offset',121],['color','yellow'],['enabled','yes']]) {
    const p=model.createProject();p.mode='highlight';p.highlight.layers[0][key]=value;
    assert.ok(model.validate(p).some(e=>/強調レイヤー/.test(e)),key);
  }
  const p=model.createProject();p.width=320;p.height=180;
  assert.deepEqual(model.validate(p).filter(e=>/強調/.test(e)),[],'inactive highlight position must not block other modes after resizing');
});
