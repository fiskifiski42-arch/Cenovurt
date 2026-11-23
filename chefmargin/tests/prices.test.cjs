const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../web/pricing.js');
const C=require('../web/core.js');
const S=require('../web/seed-locale.js');
const current=new Date().toISOString().slice(0,10);
const feed={version:1,sourceDate:current,currency:'EUR',source:'КЗП',sourceUrl:'https://kolkostruva.bg/opendata',items:{
 RICE:[{name:'Ориз 1 кг',store:'Магазин A',price:2,qty:1000,unit:'g',perUnit:0.002},{name:'Ориз 1 кг',store:'Магазин B',price:3,qty:1000,unit:'g',perUnit:0.003}],
 CHKN:[{name:'Пилешко филе 1 кг',store:'Магазин A',price:8,qty:1000,unit:'g',perUnit:0.008}],
 MAYO:[{name:'Майонеза 500 мл',store:'Магазин B',price:3,qty:500,unit:'ml',perUnit:0.006}]
}};
test('validates source age and rejects unavailable data',()=>{
 assert.equal(P.validate(feed),feed);assert.throws(()=>P.validate({...feed,sourceDate:'2024-01-01'}));
 assert.throws(()=>P.validate({...feed,items:null}));
});
test('calculates retail prices from real quantities and uses lower median',()=>{
 const i=C.initial().ingredients.find(x=>x.id==='RICE'),m=P.offers(feed,i,S.name(i,'bg'));
 assert.equal(m.items.length,2);assert.equal(m.median.perUnit,0.002);
 const updated=P.apply(i,m);assert.equal(updated.packQty,1000);assert.equal(updated.packPrice,2);assert.match(updated.priceSource,/КЗП/);
 assert.equal(C.normalize({...C.initial(),ingredients:[updated]}).ingredients[0].priceCheckedAt.slice(0,10),current);
});
test('never treats ml offers as gram prices',()=>{
 const i=C.initial().ingredients.find(x=>x.id==='MAYO');assert.equal(P.offers(feed,i,S.name(i,'bg')),null);
});
test('updates only matching ingredients and leaves other prices unchanged',()=>{
 const ingredients=C.initial().ingredients;
 const result=P.updateAll(ingredients,feed,i=>S.name(i,'bg'));
 assert.equal(result.updated,2);assert.equal(result.missing,12);
 assert.equal(result.ingredients.find(i=>i.id==='RICE').packPrice,2);
 assert.equal(result.ingredients.find(i=>i.id==='POTATO').packPrice,1.5);
});
test('user added ingredient is mapped by Bulgarian exact name',()=>{
 assert.equal(P.keyFor({id:'manual1',name:'яйца'}),'EGGS');
 assert.equal(P.keyFor({id:'manual2',name:'Ориз (суров)'}),'RICE');
 assert.equal(P.keyFor({id:'manual3',name:'шоколадови бонбони'}),'');
});
