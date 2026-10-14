const test = require('node:test');
const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const {seal,unseal,equalSecret,verifyInstagram} = require('../server/services/automationSecurity');
const {instagramEvents,receiveInstagram} = require('../server/services/instagramIngestion');
const {validateExtraction,extractSale} = require('../server/services/saleExtraction');
const env={SESSION_SECRET:'test-only-credential-encryption-secret'};
test('provider credentials are authenticated ciphertext with fresh nonces',()=>{
  const secret={app_secret:'synthetic-app-secret',token:'synthetic-secret-token'};
  const a=seal(secret,env),b=seal(secret,env);assert.notEqual(a,b);assert(!a.includes(secret.token));
  assert.deepEqual(unseal(a,env),secret);
  assert.throws(()=>unseal(a,{SESSION_SECRET:'different-test-encryption-secret'}));
  const parts=a.split('.');parts[3]=Buffer.from('changed').toString('base64url');assert.throws(()=>unseal(parts.join('.'),env));
  assert.throws(()=>seal(secret,{SESSION_SECRET:'short'}));
});
test('Instagram signature verifies the exact raw bytes and rejects forged or absent signatures',()=>{
  const raw=Buffer.from('{"object":"instagram"}'),secret='test-signature-secret';
  const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
  assert(verifyInstagram(raw,signature,secret));assert(!verifyInstagram(Buffer.from(raw+' '),signature,secret));
  assert(!verifyInstagram(raw,undefined,secret));assert(!verifyInstagram(raw,signature,'another-secret'));
  assert(!equalSecret(undefined,undefined));assert(!equalSecret('',''));assert(!equalSecret('short','longer'));
});
const payload=()=>({object:'instagram',entry:[{id:'123456',messaging:[{sender:{id:'999999'},recipient:{id:'123456'},timestamp:Date.now(),message:{mid:'message-1',text:'Would you take $200?'}}]}]});
test('only connected-account notifications become private drafts, including outgoing context',()=>{
  const p=payload(),row=instagramEvents(p,'123456')[0];
  assert.equal(row.status,'pending');assert.deepEqual(row.draft,{});assert.equal(row.external_id,'message-1');
  assert.equal(row.source_text,'Customer: Would you take $200?');assert.equal(row.conversation_id,'999999');
  assert.equal(instagramEvents(p,'654321').length,0);
  p.entry[0].messaging[0].sender.id='123456';p.entry[0].messaging[0].recipient.id='999999';
  assert.match(instagramEvents(p,'123456')[0].source_text,/^Business:/);
  p.entry[0].messaging[0].message.mid='';assert.equal(instagramEvents(p,'123456').length,0);
  p.entry[0].messaging[0].message.mid='a'.repeat(501);assert.equal(instagramEvents(p,'123456').length,0);
});
test('repeated provider notifications use source/account/message identity without overwriting reviewed drafts',async()=>{
  const seen=new Set();let options;
  const sb={from(name){assert.equal(name,'os_sale_inbox');return {upsert(rows,opts){options=opts;const added=rows.filter(r=>{const key=r.source+':'+r.account_id+':'+r.external_id;if(seen.has(key))return false;seen.add(key);return true;});return {select:async()=>({data:added,error:null})};}};}};
  const p=payload();assert.equal((await receiveInstagram(sb,p,'123456')).length,1);assert.equal((await receiveInstagram(sb,p,'123456')).length,0);
  assert.deepEqual(options,{onConflict:'source,account_id,external_id',ignoreDuplicates:true});
});
const draft=()=>({summary:'Possible sale for review',questions:[],fields:{item:'Jordan 4',quantity:1,sale_total:200,cost_total:null,fees_total:null,sold_on:null,payment_reference:null,notes:'Offer only; no payment confirmed.'}});
test('AI sale extraction preserves missing costs and dates and cannot assert payment confirmation',async()=>{
  const data=await extractSale('Would you take $200 for this pair?','instagram',{generate:async()=>draft()});
  assert.equal(data.fields.cost_total,null);assert.equal(data.fields.sold_on,null);assert(data.questions.some(q=>q.includes('actual payment')));
  const bad=draft();bad.fields.payment_confirmed=true;assert.throws(()=>validateExtraction(bad,'instagram'));
  const invalidDate=draft();invalidDate.fields.sold_on='2026-02-30';assert.throws(()=>validateExtraction(invalidDate,'instagram'));
  const fractional=draft();fractional.fields.sale_total=10.999;assert.throws(()=>validateExtraction(fractional,'instagram'));
});
