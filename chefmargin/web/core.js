/* ChefMargin calculation engine. No external services, reusable across Android / Windows / web. */
(function(global){
  'use strict';
  const finite=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
  const safe=(v)=>Math.max(0,finite(v));
  const makeId=()=>('cm_'+Math.random().toString(36).slice(2,10)+'_'+Date.now().toString(36));
  const initial=()=>({version:2,language:'bg',currency:'EUR',theme:'dark',ingredients:[
    {id:'CHKN',name:'Chicken breast',packQty:1000,packPrice:8.2,yield:90,unit:'g',supplier:'Wholesale'},
    {id:'RICE',name:'Dry rice',packQty:1000,packPrice:2.4,yield:100,unit:'g',supplier:'Wholesale'},
    {id:'ONION',name:'Onion',packQty:1000,packPrice:1.4,yield:88,unit:'g',supplier:'Market'},
    {id:'OIL',name:'Cooking oil',packQty:1000,packPrice:3.5,yield:100,unit:'ml',supplier:'Wholesale'},
    {id:'TOM',name:'Tomato sauce',packQty:1000,packPrice:3,yield:95,unit:'g',supplier:'Wholesale'},
    {id:'MOZZ',name:'Mozzarella',packQty:1000,packPrice:8.5,yield:100,unit:'g',supplier:'Wholesale'},
    {id:'FLOUR',name:'Flour',packQty:1000,packPrice:1.3,yield:100,unit:'g',supplier:'Wholesale'},
    {id:'YEAST',name:'Yeast',packQty:1000,packPrice:9,yield:100,unit:'g',supplier:'Wholesale'},
    {id:'SALT',name:'Salt',packQty:1000,packPrice:.9,yield:100,unit:'g',supplier:'Wholesale'},
    {id:'BEEF',name:'Ground beef',packQty:1000,packPrice:12.5,yield:85,unit:'g',supplier:'Wholesale'},
    {id:'BUN',name:'Burger bun',packQty:6,packPrice:3,yield:100,unit:'pcs',supplier:'Bakery'},
    {id:'CHEESE',name:'Cheddar',packQty:1000,packPrice:9,yield:100,unit:'g',supplier:'Wholesale'},
    {id:'POTATO',name:'Potatoes',packQty:1000,packPrice:1.5,yield:80,unit:'g',supplier:'Market'},
    {id:'MAYO',name:'Mayonnaise',packQty:1000,packPrice:5,yield:100,unit:'g',supplier:'Wholesale'}
  ],recipes:[
    {id:'CHICKEN',name:'Grilled Chicken & Rice',category:'Main',servings:4,otherBatchCost:.4,target:30,vat:20,salePrice:11.9,photo:'',lines:[{ingredientId:'CHKN',qty:700},{ingredientId:'RICE',qty:300},{ingredientId:'ONION',qty:100},{ingredientId:'OIL',qty:30}]},
    {id:'PIZZA',name:'Margherita Pizza',category:'Pizza',servings:4,otherBatchCost:.6,target:30,vat:20,salePrice:9.9,photo:'',lines:[{ingredientId:'FLOUR',qty:600},{ingredientId:'YEAST',qty:12},{ingredientId:'TOM',qty:450},{ingredientId:'MOZZ',qty:350},{ingredientId:'OIL',qty:15},{ingredientId:'SALT',qty:8}]},
    {id:'BURGER',name:'Beef Burger & Wedges',category:'Main',servings:4,otherBatchCost:.8,target:30,vat:20,salePrice:15.9,photo:'',lines:[{ingredientId:'BEEF',qty:700},{ingredientId:'BUN',qty:4},{ingredientId:'CHEESE',qty:160},{ingredientId:'POTATO',qty:250},{ingredientId:'MAYO',qty:60}]}
  ]});
  function unitCost(ingredient){const q=safe(ingredient.packQty),y=safe(ingredient.yield)/100;return(q>0&&y>0)?safe(ingredient.packPrice)/(q*y):0;}
  function recipeMetrics(recipe,ingredients){
    const map=new Map(ingredients.map(i=>[String(i.id),i]));
    const costs=(recipe.lines||[]).map(line=>{const i=map.get(String(line.ingredientId)),qty=safe(line.qty);return {ingredient:i||null,qty,amount:i?unitCost(i)*qty:0,missing:!i};});
    const batch=costs.reduce((s,l)=>s+l.amount,0)+safe(recipe.otherBatchCost);
    const servings=safe(recipe.servings),cost=servings>0?batch/servings:0;
    const target=safe(recipe.target)/100,vat=safe(recipe.vat)/100;
    const suggested=target>0?cost/target*(1+vat):0;
    const gross=safe(recipe.salePrice),net=gross/(1+vat),contribution=net-cost;
    const actualFoodPct=net>0?(cost/net)*100:0;
    return {lines:costs,batch,cost,suggested,net,contribution,actualFoodPct,alert:gross>0&&target>0&&actualFoodPct>target*100,missing:costs.some(x=>x.missing),marginPct:net>0?100*contribution/net:0};
  }
  function normalize(raw){
    if(!raw||typeof raw!=='object'||!Array.isArray(raw.ingredients)||!Array.isArray(raw.recipes))throw Error('Invalid backup format');
    const parse=(v,max=1e12)=>Math.min(max,safe(v));
    const ingredients=raw.ingredients.slice(0,5000).map((i,j)=>({id:String(i.id||'I'+j).slice(0,90),name:String(i.name||'').slice(0,150),packQty:parse(i.packQty),packPrice:parse(i.packPrice),yield:Math.min(100,parse(i.yield)),unit:['g','ml','pcs'].includes(i.unit)?i.unit:'g',supplier:String(i.supplier||'').slice(0,120)}));
    const recipes=raw.recipes.slice(0,2000).map((r,j)=>({id:String(r.id||'R'+j).slice(0,90),name:String(r.name||'').slice(0,150),category:String(r.category||'Main').slice(0,50),servings:parse(r.servings),otherBatchCost:parse(r.otherBatchCost),target:Math.min(100,parse(r.target)),vat:Math.min(100,parse(r.vat)),salePrice:parse(r.salePrice),photo:typeof r.photo==='string'&&r.photo.startsWith('data:image/')&&r.photo.length<1100000?r.photo:'',lines:(Array.isArray(r.lines)?r.lines:[]).slice(0,100).map(x=>({ingredientId:String(x.ingredientId||'').slice(0,90),qty:parse(x.qty)}))}));
    return {version:2,language:String(raw.language||'bg'),currency:String(raw.currency||'EUR').slice(0,8),theme:raw.theme==='light'?'light':'dark',ingredients,recipes};
  }
  const round=(n,dp=2)=>Math.round((n+Number.EPSILON)*10**dp)/10**dp;
  global.ChefCore={initial,unitCost,recipeMetrics,normalize,makeId,round};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.ChefCore;
})(typeof globalThis!=='undefined'?globalThis:this);
