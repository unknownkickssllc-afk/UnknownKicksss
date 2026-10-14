// Real Express entry point; only the database and AI boundaries are replaced.
const { randomUUID } = require('node:crypto');
const { seal } = require('../../server/services/automationSecurity');
const { SOURCE_SPREADSHEET_ID } = require('../../server/services/sheetSync');
const tables = new Map([
  ['os_automation_connections', [
    { provider:'google_sheets',external_id:SOURCE_SPREADSHEET_ID,enabled:true,config:{},secret_ciphertext:seal({token:'test-only-sheet-token'}),last_received_at:null,last_error:null },
    { provider:'instagram',external_id:'123456789',enabled:true,config:{app_id:'987654321'},secret_ciphertext:seal({app_secret:'test-only-instagram-signing-secret',verify_token:'test-only-instagram-verify-token'}),last_received_at:null,last_error:null },
  ]],
  ['os_sale_inbox', []], ['os_sheet_snapshots', []], ['os_offsite_sales', []],
]);
let databaseCalls=0,writes=0,backgroundCalls=0;
function from(name) {
  databaseCalls++;
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
  if(message.type==='stats')process.send({type:'stats',id:message.id,databaseCalls,writes,backgroundCalls,inbox:tables.get('os_sale_inbox').length,snapshots:tables.get('os_sheet_snapshots').length});
  if(message.type==='staleCiphertext'){
    const row=tables.get('os_automation_connections').find(value=>value.provider==='google_sheets');
    row.secret_ciphertext=seal({token:'test-only-previous-sheet-token'},{SESSION_SECRET:'test-only-previous-session-encryption-key'});
    process.send({type:'staleCiphertext',id:message.id});
  }
});
process.on('disconnect',()=>server.close(()=>process.exit(0)));
