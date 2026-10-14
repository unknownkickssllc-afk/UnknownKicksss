const {it}=require('node:test');
const assert=require('node:assert/strict');
const {buildWebsiteExport,loadWebsiteExport,exportReceipt,readExportReceipt,websiteExportStatus,LIMIT}=require('../server/services/websiteSheetExport');
const {SOURCE_SPREADSHEET_ID}=require('../server/services/sheetSync');
const now=new Date('2026-10-14T20:00:00Z');
const order=(id=1,changes={})=>({id,order_number:'UK-TEST-'+id,created_at:'2026-10-14T02:00:00Z',payment_status:'paid',status:'confirmed',stripe_session_id:'fixture-payment-'+id,subtotal:'150.00',total:'155.00',items:[{id:id*2,product_name:'Shoes',size:'9',color:'Black',quantity:2,line_total:'150.00'}],...changes});
it('exports paid website purchases once per order, totals once for multiple items, and dates in the business time zone',()=>{
  const input=[order(2,{payment_status:'pending'}),order(1,{items:[...order().items,{product_name:'Socks',quantity:1,line_total:'10.00'}],subtotal:160,total:165,customer_name:'Private name',customer_email:'private@example.test',shipping_json:{address:'private'}})];
  const report=buildWebsiteExport(input,{now});
  assert.equal(report.rows.length,1);assert.deepEqual(report.summary,{orderCount:1,reviewCount:0});
  assert.deepEqual(report.rows[0].slice(0,5),['website:1','UK-TEST-1','2026-10-13','paid','confirmed']);
  assert.deepEqual(report.rows[0].slice(6),[3,160,165,165,'']);
  assert.doesNotMatch(JSON.stringify(report),/Private name|private@example|fixture-payment|shipping_json/);
});
it('flags uncertain and duplicate payments without counting their money or inventing fees, costs, or profits',()=>{
  const rows=[order(1,{stripe_session_id:'same'}),order(2,{stripe_session_id:'same'}),order(3,{status:'cancelled'}),order(4,{stripe_session_id:null}),order(5,{items:[]}),order(6,{subtotal:null}),order(7,{created_at:'invalid'}),order(8,{items:[{product_name:'Bad item',quantity:0,line_total:150}]})];
  const report=buildWebsiteExport(rows,{now});
  assert.equal(report.summary.orderCount,0);assert.equal(report.summary.reviewCount,8);
  assert.ok(report.rows.every(row=>row[9]==='' && row[10]));
  assert.equal(report.rows[5][7],'');assert.equal(report.rows[6][2],'');
  assert.doesNotMatch(report.headers.join(','),/net profit|fees|cost/i);
});
it('reflects refunds/status changes and corrections on a stable ID instead of appending history, with a time-independent content hash',()=>{
  const original=buildWebsiteExport([order()],{now});
  assert.equal(buildWebsiteExport([order()],{now:new Date(now.valueOf()+60000)}).hash,original.hash);
  const updated=buildWebsiteExport([order(1,{total:159})],{now});
  assert.equal(updated.rows[0][0],original.rows[0][0]);assert.equal(updated.rows[0][8],159);assert.notEqual(updated.hash,original.hash);
  assert.equal(buildWebsiteExport([order(1,{payment_status:'refunded'})],{now}).rows.length,0);
  assert.throws(()=>buildWebsiteExport([order(),order()]),/completely/);
});
it('authenticates delivery receipts and rejects edited, wrong-purpose, expired and future receipts',()=>{
  const env={SESSION_SECRET:'website-export-test-session-secret-32'};
  const report=buildWebsiteExport([order()],{now}),receipt=exportReceipt(report,env);
  assert.equal(readExportReceipt(receipt,{env,now}).orderCount,1);
  assert.equal(readExportReceipt(receipt+'x',{env,now}),null);
  assert.equal(readExportReceipt(receipt,{env:{SESSION_SECRET:'different-session-key-for-testing'},now}),null);
  assert.equal(readExportReceipt(receipt,{env,now:new Date(now.valueOf()+1800001)}),null);
  assert.equal(readExportReceipt(receipt,{env,now:new Date(now.valueOf()-60001)}),null);
  const wrong=exportReceipt({...report,spreadsheetId:'wrong' },env);
  assert.equal(readExportReceipt(wrong,{env,now}),null);
  assert.equal(websiteExportStatus({enabled:true,config:{websiteExport:{hash:report.hash}}}).installed,false);
  const status=websiteExportStatus({enabled:false,config:{websiteExport:{sheetId:0,lastSyncedAt:now.toISOString(),orderCount:1,reviewCount:0,hash:report.hash,secret:'should not escape'}}});
  assert.equal(status.installed,true);assert.equal(status.enabled,false);assert.equal(status.sheetId,0);assert.doesNotMatch(JSON.stringify(status),/hash|secret/);
});
function database(orders,items,{errorTable=null}={}) {
  const calls=[];
  return {calls,from(table) {
    const query={table,filters:[]};calls.push(query);
    const chain={select(columns){query.columns=columns;return chain;},eq(key,value){query.filters.push(row=>row[key]===value);return chain;},in(key,values){query.filters.push(row=>values.includes(row[key]));return chain;},order(){return chain;},range(a,b){query.range=[a,b];return chain;},then(resolve,reject){return Promise.resolve().then(()=>{
      if(table===errorTable)return {data:null,error:{message:'private database detail'}};
      const source=table==='orders'?orders:items;
      return {data:source.filter(row=>query.filters.every(f=>f(row))).slice(query.range[0],query.range[1]+1),error:null};
    }).then(resolve,reject);}};return chain;
  }};
}
it('reads beyond API caps in bounded complete pages and never asks for customer or delivery information',async()=>{
  const orders=Array.from({length:1001},(_,i)=>order(i+1));
  const items=orders.map(o=>({...o.items[0],order_id:o.id}));
  const sb=database(orders,items);const result=await loadWebsiteExport(sb,{now});
  assert.equal(result.rows.length,1001);assert.equal(result.summary.orderCount,1001);
  assert.equal(sb.calls.filter(c=>c.table==='orders').length,3);
  assert.ok(sb.calls.every(c=>!c.columns.includes('*')&&!/customer|shipping|billing/.test(c.columns)));
  const failed=database(orders,items,{errorTable:'order_items'});
  await assert.rejects(()=>loadWebsiteExport(failed),error=>error.safe && !error.message.includes('private database detail'));
  const oversized=database(Array.from({length:LIMIT+1},(_,i)=>order(i+1)),[]);
  await assert.rejects(()=>loadWebsiteExport(oversized),/export limit/);
});
