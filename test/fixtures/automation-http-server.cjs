// Real Express entry point; only the database and AI boundaries are replaced.
const { randomUUID } = require('node:crypto');
const { seal } = require('../../server/services/automationSecurity');
const { SOURCE_SPREADSHEET_ID } = require('../../server/services/sheetSync');
const fixtureOrders = [
  {id:1,order_number:'UK-PAID-1',payment_status:'paid',status:'confirmed',stripe_session_id:'cs_private_unique_1',subtotal:100,total:110},
  {id:2,order_number:'UK-UNPAID-2',payment_status:'pending',status:'pending',stripe_session_id:'cs_private_unpaid_2',subtotal:90,total:99},
  {id:3,order_number:'UK-CANCELLED-3',payment_status:'paid',status:'cancelled',stripe_session_id:'cs_private_cancelled_3',subtotal:80,total:88},
  {id:4,order_number:'UK-DUPLICATE-4',payment_status:'paid',status:'confirmed',stripe_session_id:'cs_private_duplicate',subtotal:70,total:77},
  {id:5,order_number:'UK-DUPLICATE-5',payment_status:'paid',status:'confirmed',stripe_session_id:'cs_private_duplicate',subtotal:70,total:77},
  {id:6,order_number:'UK-NO-REFERENCE-6',payment_status:'paid',status:'confirmed',stripe_session_id:null,subtotal:60,total:66},
  {id:7,order_number:'UK-REFUNDED-7',payment_status:'refunded',status:'cancelled',stripe_session_id:'cs_private_refunded_7',subtotal:40,total:44},
  {id:8,order_number:'UK-PAID-8',payment_status:'paid',status:'delivered',stripe_session_id:'cs_private_unique_8',subtotal:50,total:55},
].map(order=>({...order,created_at:'2026-10-15T02:30:00.000Z',customer_name:'PRIVATE CUSTOMER NAME',customer_email:'private-customer@example.test',customer_phone:'private-phone',shipping_address:'PRIVATE STREET ADDRESS',payment_intent_id:'pi_private_payment',notes:'PRIVATE ORDER NOTE',cost_total:37,fees_total:2}));
const fixtureItems=fixtureOrders.map(order=>({id:order.id,order_id:order.id,product_name:'Synthetic website item '+order.id,size:'9',color:'Blue',quantity:1,line_total:order.subtotal,cost_total:37,notes:'PRIVATE ITEM NOTE'}));
const tableCalls={},financialTables=new Set(['orders','order_items','os_offsite_sales']);
const tables = new Map([
  ['orders',fixtureOrders],['order_items',fixtureItems],
  ['os_automation_connections', [
    { provider:'google_sheets',external_id:SOURCE_SPREADSHEET_ID,enabled:true,config:{},secret_ciphertext:seal({token:'test-only-sheet-token'}),last_received_at:null,last_error:null },
    { provider:'instagram',external_id:'123456789',enabled:true,config:{app_id:'987654321'},secret_ciphertext:seal({app_secret:'test-only-instagram-signing-secret',verify_token:'test-only-instagram-verify-token'}),last_received_at:null,last_error:null },
  ]],
  ['os_sale_inbox', []], ['os_sheet_snapshots', []], ['os_offsite_sales', []],
]);
let databaseCalls=0,writes=0,backgroundCalls=0,financialWrites=0;
function from(name) {
  databaseCalls++;tableCalls[name]=(tableCalls[name]||0)+1;
  if(!tables.has(name))throw new Error('Unexpected automation test table: '+name);
  let filters=[],sort=[],range=null,limit=null,single=false,columns='*',operation=null,payload,options;
  const query={
    select(value='*'){columns=value;return query;},
    eq(key,value){filters.push(row=>row[key]===value);return query;},
    in(key,values){filters.push(row=>values.includes(row[key]));return query;},
    lt(key,value){filters.push(row=>row[key]<value);return query;},
    order(key,{ascending=true}={}){sort.push([key,ascending]);return query;},
    limit(value){limit=value;return query;},range(start,end){range=[start,end];return query;},
    maybeSingle(){single=true;return query;},single(){single=true;return query;},
    insert(value){operation='insert';payload=value;return query;},
    update(value){operation='update';payload=value;return query;},
    upsert(value,config){operation='upsert';payload=value;options=config;return query;},
    then(resolve,reject){return Promise.resolve().then(()=>{
      if(operation&&financialTables.has(name))financialWrites++;
      let rows=tables.get(name),result=rows.filter(row=>filters.every(filter=>filter(row)));
      if(operation==='insert'||operation==='upsert'){
        result=[];
        for(const input of Array.isArray(payload)?payload:[payload]){
          const conflictKeys=operation==='upsert'?options.onConflict.split(','):name==='os_sheet_snapshots'?['content_hash']:[];
          const existing=conflictKeys.length&&rows.find(row=>conflictKeys.every(key=>row[key]===input[key]));
          if(existing){
            if(operation==='insert')return {data:null,error:{code:'23505'}};
            if(options.ignoreDuplicates)continue;
            Object.assign(existing,structuredClone(input));result.push(existing);writes++;
          }else{
            const row={id:randomUUID(),created_at:new Date().toISOString(),received_at:new Date().toISOString(),...structuredClone(input)};
            rows.push(row);result.push(row);writes++;
          }
        }
      }else if(operation==='update'){
        result.forEach(row=>Object.assign(row,structuredClone(payload)));writes+=result.length;
      }
      for(const [key,ascending] of [...sort].reverse())result.sort((a,b)=>(a[key]<b[key]?-1:a[key]>b[key]?1:0)*(ascending?1:-1));
      if(range)result=result.slice(range[0],range[1]+1);if(limit!==null)result=result.slice(0,limit);
      const projected=result.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key,structuredClone(row[key]??null)])));
      return {data:single?projected[0]||null:projected,error:null};
    }).then(resolve,reject);},
  };
  return query;
}
const database=require('../../server/lib/supabase');
database.supabase=()=>({from});database.getSupabase=database.supabase;
const extraction=require('../../server/services/saleExtraction');
extraction.processPending=async()=>{backgroundCalls++;};
extraction.prepareInbox=async()=>{throw new Error('AI is disabled in HTTP security tests');};
global.fetch=async()=>{throw new Error('External network is disabled in automation HTTP tests');};
const app=require('../../server.js');
const server=app.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',message=>{
  if(message.type==='stats')process.send({type:'stats',id:message.id,databaseCalls,writes,backgroundCalls,financialWrites,tableCalls,orderCount:tables.get('orders').length,itemCount:tables.get('order_items').length,offsiteSales:tables.get('os_offsite_sales').length,inbox:tables.get('os_sale_inbox').length,snapshots:tables.get('os_sheet_snapshots').length});
  if(message.type==='staleCiphertext'){
    const row=tables.get('os_automation_connections').find(value=>value.provider==='google_sheets');
    row.secret_ciphertext=seal({token:'test-only-previous-sheet-token'},{SESSION_SECRET:'test-only-previous-session-encryption-key'});
    process.send({type:'staleCiphertext',id:message.id});
  }
});
process.on('disconnect',()=>server.close(()=>process.exit(0)));
