const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.CRON_SECRET='test-only-sample-secret-long-enough-2026';
const lib=require('../api/_lib');
const state=new Map();
lib.redis=async (command,key,...args)=>{
  if(command==='GET')return state.get(key)||null;
  if(command==='SET'){
    if(args.includes('NX')&&state.has(key))return null;
    state.set(key,args[0]);return 'OK';
  }
  if(command==='INCR'){
    const n=Number(state.get(key)||0)+1;state.set(key,String(n));return n;
  }
  if(command==='EXPIRE')return 1;
  if(command==='DEL'){state.delete(key);return 1}
  return null;
};
const auth=require('../api/_auth');
const confirm=require('../api/confirm-login');
const session=require('../api/session');
const logout=require('../api/logout');
const {allowIpRequest}=require('../api/_rate-limit');

async function call(handler,method,body,headers={}){
  const sent={headers:{},status:null,body:null};
  const req={method,body,headers:{host:'cenovurt.vercel.app',origin:'https://cenovurt.vercel.app',...headers}};
  const res={setHeader(name,value){sent.headers[name.toLowerCase()]=value},
    set statusCode(n){sent.status=n},end(t){sent.body=JSON.parse(t)}};
  await handler(req,res);return sent;
}
test('OTP confirmation issues an HttpOnly Secure cookie, no JS token',async()=>{
  const email='safe@example.com',code='123456';
  state.set('cenovurt:login:otp:'+email,auth.oneTimeHash(email,code));
  const res=await call(confirm,'POST',{email,code},{'x-forwarded-for':'192.0.2.20'});
  assert.equal(res.status,200);
  assert.equal(res.body.email,email);
  assert.equal(Object.hasOwn(res.body,'token'),false);
  assert.match(res.headers['set-cookie'],/HttpOnly; Secure; SameSite=Lax/);
  const cookie=res.headers['set-cookie'].split(';')[0];
  const restored=await call(session,'GET',null,{cookie});
  assert.equal(restored.status,200);
  assert.equal(restored.body.email,email);
  assert.equal(auth.tokenEmail({method:'POST',headers:{cookie,origin:'https://attacker.example',host:'cenovurt.vercel.app'}}),null);
  const out=await call(logout,'POST',null,{cookie});
  assert.equal(out.status,200);
  assert.match(out.headers['set-cookie'],/Max-Age=0/);
});
test('IP budget limits bursts without storing raw IPs',async()=>{
  const req={headers:{'x-forwarded-for':'198.51.100.22'}};
  const key='test-'+Date.now();
  assert.equal(await allowIpRequest(req,key,2,60),true);
  assert.equal(await allowIpRequest(req,key,2,60),true);
  assert.equal(await allowIpRequest(req,key,2,60),false);
  assert.ok([...state.keys()].some(x=>x.includes('ip-budget:'+key+':')));
  assert.equal([...state.keys()].filter(x=>x.includes('ip-budget:'+key+':')).some(x=>x.includes('198.51.100.22')),false);
});
