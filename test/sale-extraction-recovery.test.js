const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareInbox, processPending } = require('../server/services/saleExtraction');

const firstId='00000000-0000-4000-8000-000000000001';
const secondId='00000000-0000-4000-8000-000000000002';
const row=(id,extras={})=>({id,source:'manual',status:'pending',draft:{},source_text:'Synthetic sale source',processing_until:null,updated_at:'2026-01-01T00:00:00.000Z',created_at:id===firstId?'2026-01-01T00:00:00.000Z':'2026-01-02T00:00:00.000Z',...extras});
const validDraft=()=>({summary:'Synthetic sale draft',questions:[],fields:{item:'Shoes',quantity:1,sale_total:100,cost_total:null,fees_total:null,sold_on:null,payment_reference:null,notes:'Review needed'}});

function database(initial) {
  const rows=structuredClone(initial),writes=[];
  return {rows,writes,from(table){
    assert.equal(table,'os_sale_inbox');
    let patch=null,filters=[],leaseFilter=false,sort=null,count=Infinity;
    const query={
      select(){return query;},update(value){patch=value;return query;},eq(key,value){filters.push([key,value]);return query;},
      or(){leaseFilter=true;return query;},order(key){sort=key;return query;},limit(value){count=value;return query;},
      async maybeSingle(){return execute(true);},then(resolve,reject){return Promise.resolve(execute(false)).then(resolve,reject);},
    };
    function execute(single){
      let matching=rows.filter(item=>filters.every(([key,value])=>item[key]===value)&&(!leaseFilter||!item.processing_until||Date.parse(item.processing_until)<Date.now()));
      if(sort)matching=matching.sort((a,b)=>String(a[sort]).localeCompare(String(b[sort])));
      matching=matching.slice(0,count);
      if(patch){writes.push({patch:structuredClone(patch),ids:matching.map(item=>item.id)});matching.forEach(item=>Object.assign(item,structuredClone(patch)));}
      return {error:null,data:structuredClone(single?matching[0]||null:matching)};
    }
    return query;
  }};
}

test('a failed oldest extraction moves to manual review and the next pending sale is processed',async()=>{
  const sb=database([row(firstId),row(secondId)]);
  let calls=0;
  const options={generate:async()=>{calls++;if(calls===1)throw Object.assign(new Error('Private provider error detail'),{statusCode:503});return validDraft();}};
  await processPending(sb,options);
  assert.equal(sb.rows[0].status,'review');assert.equal(sb.rows[0].processing_until,null);assert.equal(sb.rows[0].error_code,'AI_UNAVAILABLE');
  assert.deepEqual(sb.rows[0].draft,{});assert.equal(sb.rows[1].status,'pending');
  assert.doesNotMatch(JSON.stringify(sb.rows[0]),/Private provider/);
  await processPending(sb,options);
  assert.equal(calls,2);assert.equal(sb.rows[1].status,'review');assert.equal(sb.rows[1].draft.fields.item,'Shoes');
  assert.equal(sb.rows[0].error_code,'AI_UNAVAILABLE','Failed review should not be automatically retried ahead of other sales');
  await processPending(sb,options);assert.equal(calls,2);
});

test('an explicit failed retry preserves the earlier draft and can be retried successfully',async()=>{
  const previous=validDraft();const sb=database([row(firstId,{status:'review',draft:previous})]);
  await assert.rejects(prepareInbox(sb,firstId,{generate:async()=>{throw Object.assign(new Error('private timeout'),{name:'TimeoutError'});}}),error=>error.status===504&&!error.message.includes('private timeout'));
  assert.equal(sb.rows[0].status,'review');assert.equal(sb.rows[0].error_code,'AI_TIMEOUT');assert.deepEqual(sb.rows[0].draft,previous);
  const result=await prepareInbox(sb,firstId,{generate:async()=>validDraft()});
  assert.equal(result.status,'review');assert.equal(result.error_code,null);assert.equal(result.processing_until,null);
});

test('extraction failure cannot reopen or overwrite an inbox row posted or ignored during generation',async()=>{
  for(const status of ['posted','ignored']){
    const sb=database([row(firstId)]);
    await assert.rejects(prepareInbox(sb,firstId,{generate:async()=>{
      Object.assign(sb.rows[0],{status,updated_at:'2099-01-01T00:00:00.000Z',processing_until:null,draft:{owner:'preserved'}});
      throw new Error('Provider failed after owner finished the record');
    }}));
    assert.equal(sb.rows[0].status,status);assert.equal(sb.rows[0].updated_at,'2099-01-01T00:00:00.000Z');assert.deepEqual(sb.rows[0].draft,{owner:'preserved'});
    assert.deepEqual(sb.writes.at(-1).ids,[],'Recovery write must retain the old version and lease guards');
  }
});

test('successful extraction cannot overwrite a concurrent owner confirmation',async()=>{
  const sb=database([row(firstId)]);
  await assert.rejects(prepareInbox(sb,firstId,{generate:async()=>{
    Object.assign(sb.rows[0],{status:'posted',updated_at:'2099-01-01T00:00:00.000Z',processing_until:null});return validDraft();
  }}),error=>error.status===409);
  assert.equal(sb.rows[0].status,'posted');assert.equal(sb.rows[0].updated_at,'2099-01-01T00:00:00.000Z');
  assert.ok(!Object.hasOwn(sb.writes.at(-1).patch,'status'),'Conflict recovery must not request a transition back to review');
});
