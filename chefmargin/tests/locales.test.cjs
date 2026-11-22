const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../web/core.js');
const l=require('../web/seed-locale.js');
require('../web/i18n.js');
const i18n=global.ChefI18n;

test('all 28 supported languages have localized demo products and recipes',()=>{
  const base=c.initial();
  assert.equal(i18n.supported.length,28);
  for(const code of i18n.supported){
    assert.ok(l.names[code],`missing ${code}`);
    assert.equal(l.names[code].length,17);
    for(const o of [...base.ingredients,...base.recipes])assert.ok(l.name(o,code));
  }
});
test('Bulgarian product and recipe names display in a new demo without reset',()=>{
  const base=c.initial();
  assert.equal(l.name(base.ingredients[0],'bg'),'Пилешко филе');
  assert.equal(l.name(base.ingredients[1],'bg'),'Ориз (суров)');
  assert.equal(l.name(base.ingredients[13],'bg'),'Майонеза');
  assert.equal(l.name(base.recipes[0],'bg'),'Пилешко филе с ориз');
  assert.equal(l.name(base.recipes[2],'bg'),'Телешки бургер с картофи');
});
test('previous English backups also show Bulgarian, even after normalization',()=>{
  const old=c.normalize(c.initial());
  assert.equal(l.name(old.ingredients[0],'bg'),'Пилешко филе');
  assert.equal(l.name(old.recipes[1],'bg'),'Пица Маргарита');
});
test('custom names are preserved in all languages',()=>{
  const x=c.initial();x.ingredients[0].name='Пиле от местен доставчик';
  for(const code of i18n.supported)assert.equal(l.name(x.ingredients[0],code),'Пиле от местен доставчик');
  const custom={id:'i_custom',name:'Мляко'};
  for(const code of i18n.supported)assert.equal(l.name(custom,code),'Мляко');
});
test('translated seed saved from edit still switches languages',()=>{
  const x=c.initial();x.ingredients[0].name='Пилешко филе';x.recipes[0].name='Пилешко филе с ориз';
  assert.equal(l.name(x.ingredients[0],'en'),'Chicken breast');
  assert.equal(l.name(x.recipes[0],'de'),'Gegrilltes Hähnchen mit Reis');
});
test('calculations remain independent of language',()=>{
  const x=c.initial(),sum=c.recipeMetrics(x.recipes[0],x.ingredients).cost;
  x.ingredients[0].name=l.name(x.ingredients[0],'bg');
  x.recipes[0].name=l.name(x.recipes[0],'bg');
  assert.equal(c.recipeMetrics(x.recipes[0],x.ingredients).cost,sum);
});
