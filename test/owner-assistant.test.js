const assert = require('node:assert/strict');
const { it } = require('node:test');
const { createOwnerDraft, validateDraft, publicAssistantError, easternDate, systemPrompt, outputSchema } = require('../server/services/ownerAssistant');
const { createDraftHandler } = require('../server/routes/ownerAssistant');
const expense = () => ({summary:'Expense draft awaiting review',questions:[],draft:{kind:'expense',fields:{description:'Shipping labels',amount:24,category:'shipping',expense_date:'2026-10-13',notes:null}}});
function response() { return {statusCode:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(value){this.statusCode=value;return this;},json(body){this.body=body;return this;}}; }

it('uses bounded structured generation with the owner message only and no saving behavior',async()=>{
  let options;
  const result=await createOwnerDraft('Paid $24 shipping today',{env:{},now:new Date('2026-10-14T02:00:00Z'),generate:async value=>{options=value;return expense();}});
  assert.deepEqual(result,expense());
  assert.equal(options.message,'Paid $24 shipping today');
  assert.equal(options.model,'openai/gpt-5.4-mini');
  assert.equal(options.today,'2026-10-13');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(options).sort(),['message','model','signal','today']);
  assert.match(systemPrompt(options.today),/cannot read their records, change balances, save data/);
  assert.match(systemPrompt(options.today),/Missing or ambiguous values must be null/);
  assert.equal(outputSchema.additionalProperties,false);
});
it('keeps missing values null and asks for missing amounts, dates and ownership',async()=>{
  const value={summary:'Purchase draft',questions:[],draft:{kind:'purchase',fields:{title:'Sneakers',total_cost:null,purchased_at:null,ownership_type:null,notes:'Owner mentioned two pairs, no total stated.'}}};
  const result=await createOwnerDraft('Bought two pairs',{env:{AI_GATEWAY_MODEL:'test/model'},generate:async options=>{assert.equal(options.model,'test/model');return value;}});
  assert.equal(result.draft.fields.total_cost,null);
  assert.equal(result.draft.fields.purchased_at,null);
  assert.equal(result.draft.fields.ownership_type,null);
  assert.equal(result.questions.length,3);
  const consignment={summary:'Consignment draft',questions:[],draft:{kind:'consignment',fields:{item_name:'Sneakers',partner_name:null,original_cost:null,list_price:null,expected_payout:null,payout_status:null,notes:null}}};
  const pending=await createOwnerDraft('Consigned sneakers',{env:{},generate:async()=>consignment});
  assert.equal(pending.draft.fields.payout_status,null);
  assert.equal(pending.draft.fields.expected_payout,null);
  assert.ok(pending.questions.length>=5);
});
it('rejects malformed output, invented fields, invalid dates, oversized values and nonfinite amounts',()=>{
  for(const change of [value=>value.secret='x',value=>value.draft.fields.payout_received_amount=100,value=>value.draft.fields.amount=-1,value=>value.draft.fields.amount=24.123,value=>value.draft.fields.amount=Infinity,value=>value.draft.fields.amount='24',value=>value.draft.fields.expense_date='2026-02-30',value=>value.draft.fields.category='invented',value=>value.draft.kind='delete',value=>value.summary='x'.repeat(401)]){
    const value=expense();change(value);assert.throws(()=>validateDraft(value),error=>error.code==='INVALID_DRAFT');
  }
  assert.deepEqual(validateDraft({summary:'Please describe one new record',questions:['Which record do you want to add?'],draft:{kind:'unsupported',fields:{}}}).draft.fields,{});
});
it('rejects empty and oversized input without making a model call',async()=>{
  let calls=0;
  for(const message of ['',null,42,' '.repeat(20),'x'.repeat(3001)])await assert.rejects(createOwnerDraft(message,{generate:async()=>{calls++;return expense();}}),error=>error.status===400);
  assert.equal(calls,0);
  await assert.rejects(createOwnerDraft('Shipping cost $24',{env:{}}),error=>error.code==='NOT_CONFIGURED');
  assert.equal(easternDate(new Date('2026-01-01T02:00:00Z')),'2025-12-31');
});
it('does not expose provider responses, credentials or raw exceptions in error messages',()=>{
  const secret='sk-private-credential';
  for(const statusCode of [401,402,403,429,500]){
    const safe=publicAssistantError({statusCode,message:secret,responseBody:secret});
    assert.doesNotMatch(JSON.stringify(safe),new RegExp(secret));
    assert.ok(safe.status>=400);
  }
  assert.equal(publicAssistantError({name:'TimeoutError',message:secret}).status,504);
});
it('limits generation to five drafts per minute and serializes active work',async()=>{
  let time=0,calls=0;
  const handler=createDraftHandler({now:()=>time,generate:async()=>{calls++;return expense();}});
  for(let i=0;i<5;i++){const res=response();await handler({body:{message:'Paid $24 shipping today'}},res);assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'private, no-store');}
  const limited=response();await handler({body:{message:'Another'}},limited);assert.equal(limited.statusCode,429);assert.equal(calls,5);
  time=60001;const renewed=response();await handler({body:{message:'Another'}},renewed);assert.equal(renewed.statusCode,200);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const busy=createDraftHandler({generate:async()=>{await gate;return expense();}});
  const first=busy({body:{message:'One'}},response());const second=response();await busy({body:{message:'Two'}},second);assert.equal(second.statusCode,429);release();await first;
});
it('rejects invalid route bodies and sanitizes failures while allowing a later retry',async()=>{
  let calls=0;
  const handler=createDraftHandler({generate:async()=>{calls++;if(calls===1)throw {statusCode:402,message:'private payment body'};return expense();}});
  const invalid=response();await handler({body:{message:[]}},invalid);assert.equal(invalid.statusCode,400);assert.equal(calls,0);
  const failure=response();await handler({body:{message:'Shipping'}},failure);assert.equal(failure.statusCode,503);assert.match(failure.body.error,/credits or billing/);assert.doesNotMatch(failure.body.error,/private payment body/);
  const retry=response();await handler({body:{message:'Shipping'}},retry);assert.equal(retry.statusCode,200);
});

it('rejects unsupported consignment payout states without inventing a received payment',()=>{
  const draft={summary:'Consignment draft',questions:[],draft:{kind:'consignment',fields:{item_name:'Sneakers',partner_name:'Store',original_cost:20,list_price:50,expected_payout:35,payout_status:'cancelled',notes:null}}};
  assert.throws(()=>validateDraft(draft),error=>error.code==='INVALID_DRAFT');
  draft.draft.fields.payout_status='pending';assert.equal(validateDraft(draft).draft.fields.payout_status,'pending');
  draft.draft.fields.payout_received_amount=35;assert.throws(()=>validateDraft(draft),error=>error.code==='INVALID_DRAFT');
});


it('recognizes exact Gateway billing verification codes inside SDK-wrapped responses without exposing provider details',()=>{
  const secret='sk-do-not-expose-provider-key', url='https://private.example/billing?token='+secret;
  const wire={error:{type:'forbidden',code:'customer_verification_required',message:'Raw message '+secret+' '+url,param:{privateAccount:secret}},generationId:'private-generation'};
  for(const container of [{responseBody:JSON.stringify(wire)},{data:wire},{response:wire}]){
    const sdkError={name:'GatewayForbiddenError',type:'forbidden',statusCode:403,message:secret,cause:{name:'AI_APICallError',statusCode:403,url,requestBodyValues:{secret},...container}};
    const result=publicAssistantError(sdkError);
    assert.equal(result.status,503);assert.equal(result.code,'AI_BILLING_VERIFICATION_REQUIRED');
    assert.match(result.error,/billing verification/);
    assert.doesNotMatch(JSON.stringify(result),/sk-do-not|private\.example|private-generation|privateAccount/);
    assert.deepEqual(Object.keys(result).sort(),['code','error','status']);
  }
});
it('distinguishes Gateway credits, authentication, model lookup and policy failures using exact structured identifiers',()=>{
  for(const [type,statusCode,code] of [['insufficient_credits',403,'AI_CREDITS_REQUIRED'],['authentication_error',401,'AI_AUTHENTICATION_REQUIRED'],['model_not_found',404,'AI_MODEL_UNAVAILABLE'],['forbidden',403,'AI_ACCESS_DENIED'],['rate_limit_exceeded',429,'AI_RATE_LIMITED']]){
    const result=publicAssistantError({name:'GatewayInternalServerError',statusCode:500,cause:{statusCode,data:{error:{type,message:'secret raw response',param:{key:'secret'}}}}});
    assert.equal(result.code,code);assert.doesNotMatch(JSON.stringify(result),/secret raw|"key"/);
  }
  assert.equal(publicAssistantError({name:'GatewayModelNotFoundError',statusCode:404,message:'private model'}).code,'AI_MODEL_UNAVAILABLE');
});
it('does not infer verification from free text, malformed JSON, unknown codes, oversized bodies, or circular errors',()=>{
  const plain=publicAssistantError({statusCode:403,message:'customer_verification_required secret'});
  assert.equal(plain.code,'AI_ACCESS_DENIED');assert.doesNotMatch(plain.error,/billing verification|secret/);
  for(const responseBody of ['customer_verification_required','{invalid json','{"error":{"code":"customer_verification_required_secret"}}','{"message":"customer_verification_required"}','{"error":{"code":"customer_verification_required"},"large":"'+'x'.repeat(17000)+'"}']){
    assert.equal(publicAssistantError({statusCode:403,cause:{responseBody}}).code,'AI_ACCESS_DENIED');
  }
  const circular={statusCode:403};circular.cause=circular;
  assert.equal(publicAssistantError(circular).code,'AI_ACCESS_DENIED');
  assert.doesNotMatch(publicAssistantError({code:'INVALID_DRAFT',message:'secret raw provider message'}).error,/secret/);
});
