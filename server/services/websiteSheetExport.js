const {createHash} = require('node:crypto');
const {seal,unseal} = require('./automationSecurity');
const {SOURCE_SPREADSHEET_ID} = require('./sheetSync');
const HEADERS = Object.freeze(['Website sale ID','Order number','Order date (New York)','Payment status','Order status','Items','Units','Subtotal (USD)','Recorded total (USD)','Sales to count (USD)','Review note']);
const LIMIT = 10000;
const dateFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function fail(message='Website sales could not be exported completely. The last spreadsheet copy was kept.') { throw Object.assign(new Error(message),{safe:true,status:503}); }
function money(value) {
  if (value===null || value===undefined || value==='' || !['number','string'].includes(typeof value)) return null;
  const n=Number(value);
  return Number.isFinite(n) && n>=0 && n<=100000000 ? Math.round((n+Number.EPSILON)*100)/100 : null;
}
function day(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const calendar=new Date(value.slice(0,10)+'T12:00:00Z');
  if(!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0,10)!==value.slice(0,10)) return '';
  const date=new Date(value);
  if (!value || !Number.isFinite(date.valueOf())) return '';
  const parts=Object.fromEntries(dateFormat.formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function identifier(value) { return /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)); }
function text(value,max=500) {
  if (value==null) return '';
  if (typeof value!=='string' || value.length>max) fail();
  return value;
}
function buildWebsiteExport(orders,{now=new Date()}={}) {
  if (!Array.isArray(orders) || orders.length>LIMIT) fail();
  const paid=orders.filter(o=>o.payment_status==='paid').sort((a,b)=>Number(a.id)-Number(b.id));
  const payments=new Map(),ids=new Set();
  for(const o of paid) {
    if(!identifier(o.id) || ids.has(String(o.id))) fail();
    ids.add(String(o.id));
    if(o.stripe_session_id) payments.set(o.stripe_session_id,(payments.get(o.stripe_session_id)||0)+1);
  }
  let orderCount=0,reviewCount=0;
  const rows=paid.map(o=>{
    const notes=[],date=day(o.created_at),total=money(o.total),subtotal=money(o.subtotal);
    const items=Array.isArray(o.items)?o.items:[];
    if(!date) notes.push('Order date needs review.');
    if(total===null || subtotal===null) notes.push('Order amounts need review.');
    if(!['confirmed','processing','shipped','delivered','completed'].includes(o.status)) notes.push(o.status==='cancelled'?'Cancelled order: verify any refund before counting.':'Order status needs review.');
    if(!o.stripe_session_id) notes.push('No website payment reference: verify receipt before counting.');
    else if(payments.get(o.stripe_session_id)>1) notes.push('Payment reference appears on multiple orders: resolve before counting.');
    const quantitiesValid=items.length>0 && items.every(i=>Number.isSafeInteger(Number(i.quantity)) && Number(i.quantity)>0 && Number(i.quantity)<=100000);
    if(!quantitiesValid) notes.push('Item quantities need review.');
    const lines=items.map(i=>money(i.line_total));
    if(!items.length || lines.some(n=>n===null) || subtotal===null || Math.abs(lines.reduce((s,n)=>s+Math.round((n||0)*100),0)-Math.round(subtotal*100))>1) notes.push('Items do not reconcile to the order subtotal.');
    const description=items.map(i=>[text(i.product_name),text(i.size,100),text(i.color,100)].filter(Boolean).join(' / ')+' × '+text(String(i.quantity),20)).join('; ');
    if(description.length>4000) fail('One website order is too large for the spreadsheet export. The last complete copy was kept.');
    if(notes.length) reviewCount++;else orderCount++;
    return ['website:'+o.id,text(o.order_number),date,'paid',text(o.status,100),description,quantitiesValid?items.reduce((s,i)=>s+Number(i.quantity),0):'',subtotal??'',total??'',notes.length?'':total,notes.join(' ')];
  });
  const hash=createHash('sha256').update(JSON.stringify({headers:HEADERS,rows})).digest('hex');
  return {version:1,spreadsheetId:SOURCE_SPREADSHEET_ID,tabName:'Website Sales',generatedAt:now.toISOString(),hash,headers:[...HEADERS],rows,summary:{orderCount,reviewCount}};
}
async function loadWebsiteExport(sb,options) {
  const orders=[];
  // Stable key order and bounded complete reads avoid the Data API's default row cap.
  for(let offset=0;offset<=LIMIT;offset+=500) {
    const {data,error}=await sb.from('orders').select('id,order_number,created_at,payment_status,status,stripe_session_id,subtotal,total').eq('payment_status','paid').order('id').range(offset,offset+499);
    if(error || !Array.isArray(data)) fail();
    orders.push(...data);
    if(orders.length>LIMIT) fail('Website sales exceeded the export limit. The previous complete spreadsheet copy was kept.');
    if(data.length<500) break;
  }
  const byId=new Map(orders.map(o=>[String(o.id),{...o,items:[]}]));
  let itemCount=0;
  for(let start=0;start<orders.length;start+=100) {
    const ids=orders.slice(start,start+100).map(o=>o.id);
    for(let offset=0;offset<=50000;offset+=500) {
      const {data,error}=await sb.from('order_items').select('id,order_id,product_name,size,color,quantity,line_total').in('order_id',ids).order('id').range(offset,offset+499);
      if(error || !Array.isArray(data)) fail();
      itemCount+=data.length;if(itemCount>50000) fail();
      for(const item of data) { const order=byId.get(String(item.order_id));if(!order) fail();order.items.push(item); }
      if(data.length<500) break;
    }
  }
  return buildWebsiteExport([...byId.values()],options);
}
function exportReceipt(report,env) {
  return seal({purpose:'website-sheet-export-v1',spreadsheetId:report.spreadsheetId,generatedAt:report.generatedAt,hash:report.hash,...report.summary},env);
}
function readExportReceipt(receipt,{now=new Date(),env}={}) {
  let data;
  try {
    if(typeof receipt!=='string' || receipt.length>3000 || !/^v1(?:\.[A-Za-z0-9_-]+){3}$/.test(receipt) || receipt.split('.').slice(1).some(part=>Buffer.from(part,'base64url').toString('base64url')!==part)) throw new Error();
    data=unseal(receipt,env);
  } catch (_) { return null; }
  const age=now.valueOf()-Date.parse(data.generatedAt);
  return data.purpose==='website-sheet-export-v1' && data.spreadsheetId===SOURCE_SPREADSHEET_ID && /^[a-f0-9]{64}$/.test(data.hash) && Number.isFinite(age) && age>=-60000 && age<=1800000 && [data.orderCount,data.reviewCount].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=LIMIT) ? data : null;
}
function websiteExportStatus(connection) {
  const saved=connection?.config?.websiteExport;
  const installed=!!(saved && Number.isSafeInteger(saved.sheetId) && saved.sheetId>=0 && Number.isFinite(Date.parse(saved.lastSyncedAt)));
  return {installed,enabled:!!connection?.enabled,lastSyncedAt:installed?saved.lastSyncedAt:null,orderCount:installed?saved.orderCount:0,reviewCount:installed?saved.reviewCount:0,sheetId:installed?saved.sheetId:null,sourceUrl:'https://docs.google.com/spreadsheets/d/'+SOURCE_SPREADSHEET_ID+'/edit',tabName:'Website Sales',intervalMinutes:5};
}
module.exports={HEADERS,LIMIT,buildWebsiteExport,loadWebsiteExport,exportReceipt,readExportReceipt,websiteExportStatus};
