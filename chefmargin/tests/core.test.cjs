const {test}=require('node:test');const assert=require('node:assert/strict');const c=require('../web/core.js');
test('real yield is applied once',()=>assert.equal(c.unitCost({packQty:1000,packPrice:8.2,yield:90}),8.2/900));
test('example chicken costing and VAT',()=>{const x=c.initial(),r=x.recipes[0],m=c.recipeMetrics(r,x.ingredients);const expected=(700*8.2/900+300*2.4/1000+100*1.4/880+30*3.5/1000+.4)/4;assert.ok(Math.abs(m.cost-expected)<1e-9);assert.ok(Math.abs(m.suggested-m.cost/.3*1.2)<1e-9);assert.ok(Math.abs(m.contribution-(11.9/1.2-m.cost))<1e-9);});
test('changing price updates every connected recipe',()=>{const x=c.initial();const b=c.recipeMetrics(x.recipes[0],x.ingredients).cost;x.ingredients[0].packPrice+=1;const a=c.recipeMetrics(x.recipes[0],x.ingredients).cost;assert.ok(a>b)});
test('no divisions by zero',()=>{const m=c.recipeMetrics({servings:0,target:0,vat:0,salePrice:0,otherBatchCost:0,lines:[]},[]);assert.equal(m.cost,0);assert.equal(m.suggested,0)});
test('import backup validates',()=>{const d=c.normalize(c.initial());assert.equal(d.recipes.length,3);assert.throws(()=>c.normalize({}));});
