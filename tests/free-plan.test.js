const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const libPath = path.join(__dirname, '../api/_lib.js');
const lib = require(libPath);
const watchesByEmail = new Map();
const accountsByEmail = new Map();
const emailSent = [];
const redisValues = new Map();
Object.assign(lib, {
  getAccount: async email => accountsByEmail.get(email) || null,
  getWatches: async email => watchesByEmail.get(email) || [],
  setWatches: async (email, watches) => watchesByEmail.set(email, watches),
  redis: async (cmd, key, val) => {
    if (cmd === 'GET') return redisValues.get(key) || null;
    if (cmd === 'SET') { redisValues.set(key, val); return 'OK'; }
  },
  sendEmail: async item => { emailSent.push(item); return { id: 'mock' }; },
});
const account = require('../api/account.js');
const watches = require('../api/watches.js');
const alert = require('../api/test-alert.js');
async function call(handler, method, body, query) {
  let status;
  let result;
  const res = { setHeader:()=>{}, end: s=> {result=JSON.parse(s); }, set statusCode(v) { status=v; } };
  const req = {method, body, query};
  await handler(req, res);
  return {status,result};
}

test('JS and HTML frontend syntax valid',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const match=source.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match);
  new vm.Script(match[1]);
  assert.ok(source.includes('3 безплатни продукта'));
});

test('Vercel Hobby schedule is once a day',()=>{
  const conf=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json'),'utf8'));
  assert.equal(conf.crons[0].schedule,'17 9 * * *');
});

test('new user is Free 0/3 with no card', async()=> {
  const r=await call(account, 'GET', null, {email:'NEW@EXAMPLE.COM'});
  assert.equal(r.status,200); assert.equal(r.result.plan,'Free');
  assert.equal(r.result.limit,3); assert.equal(r.result.used,0);
  assert.equal(r.result.active,true); assert.equal(r.result.paid,false);
});

test('Free users add three watches, fourth denied', async()=> {
  for(let i=1;i<=4;i++){
    const r=await call(watches, 'POST', {email:'new@example.com', url:`https://example.com/p/${i}`, targetPrice:100});
    if(i<=3) {assert.equal(r.status,201);assert.equal(r.result.limit,3);}
    else {assert.equal(r.status,409); assert.match(r.result.error,/лимит/);}
  }
  const current=await call(account,'GET',null,{email:'new@example.com'});
  assert.equal(current.result.used,3);
});

test('Paid account keeps its existing plan limit',async()=>{
  accountsByEmail.set('paid@example.com',{plan:'Basic',limit:10});
  const r=await call(account,'GET',null,{email:'paid@example.com'});
  assert.equal(r.result.plan,'Basic'); assert.equal(r.result.limit,10); assert.equal(r.result.paid,true);
  const w=await call(watches,'POST',{email:'paid@example.com',url:'https://example.com/item',targetPrice:15});
  assert.equal(w.status,201); assert.equal(w.result.limit,10);
});

test('Free users can request one test email per 24 hours',async()=>{
  const first=await call(alert,'POST',{email:'new@example.com'});
  assert.equal(first.status,200);assert.equal(emailSent.length,1);
  assert.match(emailSent[0].html,/Free/);
  const again=await call(alert,'POST',{email:'new@example.com'});
  assert.equal(again.status,429);
});
