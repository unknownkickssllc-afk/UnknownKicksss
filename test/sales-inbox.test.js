const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSale, confirmSale, dismissInbox, summarizeSales } = require('../server/services/salesInbox');
const id = '00000000-0000-4000-8000-000000000001';
const version = '2026-01-05T14:00:00.000Z';
const body = overrides => ({ expected_updated_at:version, payment_confirmed:true, channel:'instagram', item:'Synthetic shoes', quantity:2, sale_total:180, cost_total:100, fees_total:5, sold_on:'2026-01-05', payment_reference:'  REF  123  ', notes:'Owner confirmed payment', ...overrides });

test('sale confirmation requires explicit received-payment confirmation and validates money/dates without inventing costs', () => {
  for (const invalid of [{payment_confirmed:false},{payment_confirmed:'true'},{sale_total:0},{sale_total:'180'},{sale_total:1.234},{cost_total:-1},{fees_total:Infinity},{quantity:1.5},{quantity:0},{sold_on:'2026-02-30'},{sold_on:'today'},{expected_updated_at:null},{customer_email:'not an allowed field'}]) assert.throws(()=>validateSale(body(invalid)),error=>error.status===400);
  const value = validateSale(body({cost_total:undefined,fees_total:null}));
  assert.equal(value.cost_total,null);
  assert.equal(value.fees_total,null);
  assert.equal(value.payment_reference,'ref 123');
  assert.ok(!Object.hasOwn(value,'payment_confirmed'));
});
test('confirm sends only normalized sale fields to atomic RPC and rejects bad input before data access', async () => {
  let calls = 0, args;
  const sb = { rpc:async (name,input)=>{calls++;args={name,input};return {data:{sale:{id},alreadyPosted:false},error:null};} };
  await assert.rejects(confirmSale(sb,id,body({payment_confirmed:false})),error=>error.status===400);
  assert.equal(calls,0);
  const result = await confirmSale(sb,id,body());
  assert.equal(result.alreadyPosted,false);
  assert.equal(args.name,'os_confirm_offsite_sale');
  assert.equal(args.input.p_expected_updated_at,version);
  assert.equal(args.input.p_sale.payment_reference,'ref 123');
  assert.deepEqual(Object.keys(args.input).sort(),['p_expected_updated_at','p_inbox_id','p_sale']);
});
test('confirm returns safe conflicts for stale edits, mismatched retries and duplicate payment references',async()=>{
  for(const [code,status] of [['40001',409],['23505',409],['P0001',409],['P0002',404],['22023',400]]){
    await assert.rejects(confirmSale({rpc:async()=>({error:{code,message:'private-provider-database-detail'}})},id,body()),error=>error.status===status&&!error.message.includes('private-provider'));
  }
});
test('dismissal atomically guards both version and status, and cannot dismiss a posted record',async()=>{
  const operations=[];
  const query={update(value){operations.push(['update',value]);return query;},eq(...value){operations.push(['eq',...value]);return query;},in(...value){operations.push(['in',...value]);return query;},select(){return query;},maybeSingle:async()=>({data:null,error:null})};
  await assert.rejects(dismissInbox({from:()=>query},id,version),error=>error.status===409);
  assert.ok(operations.some(op=>op[0]==='eq'&&op[1]==='updated_at'&&op[2]===version));
  assert.deepEqual(operations.find(op=>op[0]==='in'),['in','status',['pending','review']]);
  assert.equal(operations[0][1].status,'ignored');
});
test('date and channel summaries include confirmed sales only and withhold profit for unknown costs or fees',()=>{
  const rows=[
    {...validateSale(body()),confirmed_at:version},
    {...validateSale(body({channel:'in_person',sold_on:'2026-01-06',sale_total:50,cost_total:null,fees_total:0,quantity:1})),confirmed_at:version},
    {...validateSale(body({sale_total:999})),confirmed_at:null},
  ];
  const summary=summarizeSales(rows);
  assert.equal(summary.sales,2);assert.equal(summary.revenue,230);assert.equal(summary.units,3);
  assert.equal(summary.profit,null);assert.equal(summary.marginPercent,null);
  assert.equal(summary.knownProfit,75);assert.equal(summary.missingCostCount,1);assert.equal(summary.missingFeeCount,0);
  assert.deepEqual(summary.daily.map(row=>[row.date,row.profit]),[['2026-01-05',75],['2026-01-06',null]]);
  assert.equal(summary.channels.find(row=>row.channel==='instagram').revenue,180);
  assert.equal(summarizeSales([{...rows[0],fees_total:null}]).profit,null);
  assert.equal(summarizeSales([]).profit,null);
});
