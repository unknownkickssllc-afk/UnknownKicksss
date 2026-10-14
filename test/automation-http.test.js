const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const {createHmac}=require('node:crypto');
const path=require('node:path');
const {before,after,describe,it}=require('node:test');
const {SOURCE_SPREADSHEET_ID}=require('../server/services/sheetSync');
const fixturePin='1357';
const secret='test-only-instagram-signing-secret';
const sheetToken='test-only-sheet-token';
const json=(body,headers={})=>({method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
function assertPrivate(response){assert.match(response.headers.get('cache-control')||'',/private.*no-store/);assert.equal(response.headers.get('vercel-cdn-cache-control'),'no-store');}
async function start(){
  const child=fork(path.join(__dirname,'fixtures/automation-http-server.cjs'),[],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_ENV:'production',VERCEL_ENV:'production',ADMIN_PIN:fixturePin,SESSION_SECRET:'test-only-automation-session-secret-32-characters',SUPABASE_URL:'https://test-database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-fake-service-role-key-never-use-in-production',USE_SQLITE:'false',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',STRIPE_PUBLISHABLE_KEY:''}});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(new Error('Automation fixture timed out: '+output));},10000);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Automation fixture exited '+code+': '+output));});child.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);resolve(message.port);}});});
  let nextId=0;
  return {request:(url,options={})=>fetch('http://127.0.0.1:'+port+url,{redirect:'manual',...options,headers:{'x-forwarded-proto':'https',...options.headers}}),
    stats:()=>new Promise(resolve=>{const id=++nextId;const listener=message=>{if(message.type==='stats'&&message.id===id){child.off('message',listener);resolve(message);}};child.on('message',listener);child.send({type:'stats',id});}),
    staleCiphertext:()=>new Promise(resolve=>{const id=++nextId;const listener=message=>{if(message.type==='staleCiphertext'&&message.id===id){child.off('message',listener);resolve();}};child.on('message',listener);child.send({type:'staleCiphertext',id});}),
    close:async()=>{if(child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}};
}
function snapshot(){
  const row=(number,values)=>({row:number,values,display:values.map(value=>value===null?'':String(value))});
  const header=()=>row(1,['Item Name','SKU','Category','Days to Sell','Cost of Goods Sold','Quantity','Fee','Cost of Goods','Net Profit','ROI','Date charged','Sale Date']);
  const tabs=[[72108132,'May 2026'],[1515861308,'June 2026'],[295653990,'July 2026'],[1849494495,'August & September 2026']];
  const sheets=tabs.map(([id,title])=>({id,title,rows:[header()]}));
  sheets[0].rows.push(row(2,['Synthetic shoes','fixture-sku','Shoes',2,110,2,0,30,160,1,'2026-05-01','2026-05-03']));
  sheets.push({id:1402387966,title:'Expenses',rows:[row(7,['2026-05-03','Packaging','',8,'Synthetic boxes'])]});
  return {spreadsheetId:SOURCE_SPREADSHEET_ID,title:'Synthetic HTTP sheet',capturedAt:new Date().toISOString(),timeZone:'America/New_York',sheets};
}
describe('automation routes through the real deployment entry point',()=>{
  let server,cookie;
  before(async()=>{server=await start();const login=await server.request('/api/admin/login',json({code:fixturePin}));assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ');});
  after(async()=>server?.close());
  it('rejects anonymous admin access before any database call',async()=>{
    const initial=await server.stats();
    for(const [url,options] of [['/api/os/automation',{}],['/api/os/automation/inbox',json({message:'A sale',channel:'in_person'})],['/api/os/automation/sheet-installer',json({})]]){
      const response=await server.request(url,options);assert.equal(response.status,401,url);assertPrivate(response);
    }
    assert.equal((await server.stats()).databaseCalls,initial.databaseCalls);
  });
  it('accepts only the private Instagram verification token and validates exact raw-body signatures before writes',async()=>{
    const initial=await server.stats();
    const wrong=await server.request('/api/integrations/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=fixture-challenge');assert.equal(wrong.status,403);assertPrivate(wrong);
    const valid=await server.request('/api/integrations/instagram?hub.mode=subscribe&hub.verify_token=test-only-instagram-verify-token&hub.challenge=fixture-challenge');assert.equal(valid.status,200);assert.equal(await valid.text(),'fixture-challenge');assertPrivate(valid);
    const payload={object:'instagram',entry:[{id:'123456789',messaging:[{sender:{id:'55555555'},recipient:{id:'123456789'},timestamp:Date.now(),message:{mid:'fixture-message-1',text:'Synthetic shoes offer $110'}}]}]};
    const raw=JSON.stringify(payload),signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
    for(const headers of [{},{'x-hub-signature-256':'sha256='+'0'.repeat(64)}]){const bad=await server.request('/api/integrations/instagram',{method:'POST',headers:{'content-type':'application/json',...headers},body:raw});assert.equal(bad.status,401);assertPrivate(bad);}
    assert.equal((await server.stats()).writes,initial.writes);
    const changed=await server.request('/api/integrations/instagram',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw+' '});assert.equal(changed.status,401,'signature must cover the exact original bytes');
    const accepted=await server.request('/api/integrations/instagram',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw});assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{received:true});assertPrivate(accepted);
    const retried=await server.request('/api/integrations/instagram',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw});assert.equal(retried.status,200);
    assert.equal((await server.stats()).inbox,1,'provider retry must not duplicate the message');
  });
  it('rejects unauthenticated Sheets and worker calls before any database mutation or AI work',async()=>{
    const initial=await server.stats();
    for(const url of ['/api/integrations/sheets','/api/integrations/process'])for(const authorization of [undefined,'Bearer wrong-token']){
      const response=await server.request(url,json({},authorization?{authorization}:{}));assert.equal(response.status,401,url);assertPrivate(response);
    }
    const after=await server.stats();assert.equal(after.writes,initial.writes);assert.equal(after.backgroundCalls,initial.backgroundCalls);
  });
  it('ignores correctly signed notifications for another Instagram account without writes or AI work',async()=>{
    const initial=await server.stats();
    const payload={object:'instagram',entry:[{id:'987654321',messaging:[{sender:{id:'55555555'},recipient:{id:'987654321'},timestamp:Date.now(),message:{mid:'wrong-account-message',text:'Synthetic shoes offer $110'}}]}]};
    const raw=JSON.stringify(payload),signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
    const response=await server.request('/api/integrations/instagram',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw});
    assert.equal(response.status,200);assertPrivate(response);
    const final=await server.stats();assert.equal(final.writes,initial.writes);assert.equal(final.backgroundCalls,initial.backgroundCalls);assert.equal(final.inbox,initial.inbox);
  });
  it('requires JSON and a same-origin browser request for authenticated changes',async()=>{
    const initial=await server.stats();
    const cross=await server.request('/api/os/automation/inbox',json({message:'Synthetic sale',channel:'in_person'},{cookie,origin:'https://unrelated.example'}));assert.equal(cross.status,403);assertPrivate(cross);
    const form=await server.request('/api/os/automation/inbox',{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:'message=Synthetic&channel=in_person'});assert.equal(form.status,415);assertPrivate(form);
    assert.equal((await server.stats()).databaseCalls,initial.databaseCalls);
  });
  it('stores a valid normalized Sheet snapshot, rejects malformed replacements, and deduplicates identical content',async()=>{
    const input=snapshot(),headers={authorization:'Bearer '+sheetToken};
    const accepted=await server.request('/api/integrations/sheets',json(input,headers));assert.equal(accepted.status,200);assert.equal((await accepted.json()).changed,true);assertPrivate(accepted);
    const identical=await server.request('/api/integrations/sheets',json(input,headers));assert.equal(identical.status,200);assert.equal((await identical.json()).changed,false);assert.equal((await server.stats()).snapshots,1);
    const broken=structuredClone(input);broken.sheets[0].rows[1].values[4]='$110';
    const rejected=await server.request('/api/integrations/sheets',json(broken,headers));assert.equal(rejected.status,400);assert.equal((await server.stats()).snapshots,1);
    const listed=await server.request('/api/os/automation',{headers:{cookie}});assert.equal(listed.status,200);assertPrivate(listed);
    const report=await listed.json();assert.equal(report.sheet.totals.revenue,220);assert.equal(report.sheet.totals.recordedProfit,160);assert.equal(report.sheet.totals.expenses,8);assert.equal(report.summary.revenue,0,'source Sheet figures must not become confirmed offsite sales');
  });
  it('never lists integration ciphertext, signing secrets, or bearer credentials',async()=>{
    const response=await server.request('/api/os/automation',{headers:{cookie}});assert.equal(response.status,200);assertPrivate(response);
    const text=await response.text();assert.doesNotMatch(text,/secret_ciphertext|app_secret|verify_token|test-only-sheet-token|test-only-instagram-signing-secret|test-only-instagram-verify-token/);
    const report=JSON.parse(text);assert.equal(report.connections.length,2);assert.equal(report.inbox.length,1);
  });
  it('keeps the last complete snapshot and records a safe connection error when any required source tab is absent',async()=>{
    const headers={authorization:'Bearer '+sheetToken};
    const baseline=await(await server.request('/api/os/automation',{headers:{cookie}})).json();
    assert.equal(baseline.sheet.totals.revenue,220);
    for(const missing of [72108132,1515861308,295653990,1849494495,1402387966]){
      const partial=snapshot();partial.sheets=partial.sheets.filter(sheet=>sheet.id!==missing);
      const response=await server.request('/api/integrations/sheets',json(partial,headers));
      assert.equal(response.status,400,'required source tab '+missing);assertPrivate(response);
      assert.equal((await server.stats()).snapshots,1);
      const current=await(await server.request('/api/os/automation',{headers:{cookie}})).json();
      assert.equal(current.sheet.totals.revenue,baseline.sheet.totals.revenue);
      assert.equal(current.sheet.totals.recordedProfit,baseline.sheet.totals.recordedProfit);
      const connection=current.connections.find(row=>row.provider==='google_sheets');
      assert.equal(typeof connection.last_error,'string');assert.ok(connection.last_error.length>0);
      assert.doesNotMatch(connection.last_error,/test-only|Bearer|secret_ciphertext|app_secret|verify_token/);
      assert.match(connection.last_error,/incomplete|columns|previous|snapshot|source|sheet/i);
    }
  });
  it('keeps every pending draft visible beyond the former 100-record inbox limit',async()=>{
    const initial=await server.stats();
    const events=Array.from({length:101},(_,index)=>({sender:{id:'55555555'},recipient:{id:'123456789'},timestamp:Date.now()+index,message:{mid:'pagination-message-'+index,text:'Synthetic pending message '+index}}));
    for(const batch of [events.slice(0,100),events.slice(100)]){
      const entry=[];for(let offset=0;offset<batch.length;offset+=50)entry.push({id:'123456789',messaging:batch.slice(offset,offset+50)});
      const raw=JSON.stringify({object:'instagram',entry}),signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
      const response=await server.request('/api/integrations/instagram',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw});assert.equal(response.status,200);
    }
    const response=await server.request('/api/os/automation',{headers:{cookie}});assert.equal(response.status,200);assertPrivate(response);
    const report=await response.json();assert.equal(report.inbox.length,initial.inbox+101);
    assert.ok(report.inbox.some(row=>row.external_id==='fixture-message-1'),'the oldest waiting draft must not disappear');
    assert.ok(report.inbox.some(row=>row.external_id==='pagination-message-100'));
    assert.equal(new Set(report.inbox.map(row=>row.external_id)).size,report.inbox.length);
  });
  it('can reconnect the Sheet installer after encryption-key rotation without reusing the old credential',async()=>{
    await server.staleCiphertext();
    const response=await server.request('/api/os/automation/sheet-installer',json({},{cookie}));assert.equal(response.status,200);assertPrivate(response);
    const {script}=await response.json();assert.equal(typeof script,'string');assert.doesNotMatch(script,/__SYNC_TOKEN__|test-only-previous-sheet-token|test-only-sheet-token/);
    const token=script.match(/(?:var|const) UK_SYNC_TOKEN = '([^']+)'/)?.[1];assert.ok(token&&token.length>=32);
    const accepted=await server.request('/api/integrations/sheets',json(snapshot(),{authorization:'Bearer '+token}));assert.equal(accepted.status,200);
    const old=await server.request('/api/integrations/process',json({},{authorization:'Bearer '+sheetToken}));assert.equal(old.status,401);
    const listed=await server.request('/api/os/automation',{headers:{cookie}});const text=await listed.text();assert.ok(!text.includes(token));assert.doesNotMatch(text,/secret_ciphertext|test-only-previous-sheet-token/);
  });
});
