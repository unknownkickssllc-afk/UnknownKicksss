const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes,randomUUID} = require('node:crypto');
const {waitUntil} = require('@vercel/functions');
const {requireAdmin} = require('../middleware/auth');
const {supabase} = require('../lib/supabase');
const {seal,unseal,equalSecret,verifyInstagram} = require('../services/automationSecurity');
const {receiveInstagram,instagramEvents} = require('../services/instagramIngestion');
const {prepareInbox,processPending} = require('../services/saleExtraction');
const {confirmSale,dismissInbox,summarizeSales,SaleInboxError} = require('../services/salesInbox');
const {normalizeSnapshot,snapshotHash} = require('../services/sheetSync');
const SHEET_ID = '1b8IlcWscjViVLk_5eN0Wef3REYtwNl0zjy1_-j-koro';
const REQUIRED_SHEET_IDS = [72108132,1515861308,295653990,1849494495,1402387966];
const SITE = 'https://www.unknownkickss.co';
const INSTAGRAM_USER = 'unknown.kickss';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function publicError(res,error) {
  const status = [400,404,409,429,502,503,504].includes(error?.status) ? error.status : 503;
  const message = error instanceof SaleInboxError || error?.safe ? error.message : 'This connection could not be updated. Your saved records are unchanged. Please retry.';
  res.status(status).json({error:message});
}
function safeError(message,status=400) { return Object.assign(new Error(message),{status,safe:true}); }
function asyncRoute(fn) { return (req,res) => Promise.resolve(fn(req,res)).catch(error=>publicError(res,error)); }
async function connection(provider) {
  const {data,error} = await supabase().from('os_automation_connections').select('*').eq('provider',provider).maybeSingle();
  if (error) throw error;
  return data;
}
function privateResponse(_req,res,next) { res.set({'Cache-Control':'private, no-store','Vercel-CDN-Cache-Control':'no-store'});next(); }
function sameOrigin(req,res,next) {
  if (req.method==='GET') return next();
  if (!req.is('application/json')) return res.status(415).json({error:'Send a JSON request.'});
  const origin = req.get('origin');
  if (origin && origin !== req.protocol+'://'+req.get('host')) return res.status(403).json({error:'Open this action from your owner workspace.'});
  next();
}
async function sheetAuthorization(req) {
  const c = await connection('google_sheets');
  if (!c?.enabled || !c.secret_ciphertext) return null;
  const secrets = unseal(c.secret_ciphertext);
  return equalSecret(req.get('authorization'), 'Bearer '+secrets.token) ? c : null;
}
function background() { waitUntil(processPending(supabase()).catch(()=>{})); }
function reconnectSecrets(existing) {
  try { return existing?.secret_ciphertext ? unseal(existing.secret_ciphertext) : {}; }
  catch (_) { return {}; } // Explicit authenticated setup can replace credentials after key rotation.
}

const incoming = express.Router();
incoming.use(privateResponse);
incoming.get('/instagram',asyncRoute(async (req,res)=>{
  const c = await connection('instagram');
  if (!c?.enabled || !c.secret_ciphertext) return res.sendStatus(403);
  const secrets = unseal(c.secret_ciphertext);
  if (req.query['hub.mode']!=='subscribe' || !equalSecret(req.query['hub.verify_token'],secrets.verify_token) || typeof req.query['hub.challenge']!=='string' || req.query['hub.challenge'].length>500) return res.sendStatus(403);
  res.type('text/plain').send(req.query['hub.challenge']);
}));
incoming.post('/instagram',express.raw({type:'application/json',limit:'1mb'}),asyncRoute(async (req,res)=>{
  const c = await connection('instagram');
  if (!c?.enabled || !c.secret_ciphertext) return res.sendStatus(503);
  const secrets = unseal(c.secret_ciphertext);
  if (!verifyInstagram(req.body,req.get('x-hub-signature-256'),secrets.app_secret)) return res.sendStatus(401);
  let payload; try { payload=JSON.parse(req.body.toString('utf8')); } catch (_) { return res.sendStatus(400); }
  if (!instagramEvents(payload,c.external_id).length) return res.json({received:true});
  await receiveInstagram(supabase(),payload,c.external_id);
  const {error} = await supabase().from('os_automation_connections').update({last_received_at:new Date().toISOString(),last_error:null}).eq('provider','instagram');
  if (error) throw error;
  background();
  res.json({received:true});
}));
incoming.post('/sheets',express.json({limit:'3mb'}),asyncRoute(async(req,res)=>{
  const c = await sheetAuthorization(req);
  if (!c) return res.sendStatus(401);
  let snapshot;
  try {
    const ids = new Set((req.body?.sheets||[]).map(sheet=>sheet?.id));
    if (!REQUIRED_SHEET_IDS.every(id=>ids.has(id))) throw new Error('Missing source tab.');
    snapshot=normalizeSnapshot(req.body);
    if (snapshot.sourceId!==c.external_id || !Number.isFinite(Date.parse(snapshot.capturedAt)) || Date.parse(snapshot.capturedAt)>Date.now()+600000) throw new Error('Unexpected spreadsheet or capture date.');
  } catch (_) {
    const message='The sheet update was incomplete or its columns changed. The previous snapshot was kept.';
    await supabase().from('os_automation_connections').update({last_error:message}).eq('provider','google_sheets');
    throw safeError(message);
  }
  const hash=snapshotHash(snapshot);
  const {error:insertError} = await supabase().from('os_sheet_snapshots').insert({content_hash:hash,source_id:c.external_id,payload:snapshot,captured_at:snapshot.capturedAt});
  if (insertError && insertError.code!=='23505') throw insertError;
  // A source can legitimately return to an earlier value; its latest observation still wins.
  if (insertError?.code==='23505') {
    const {error} = await supabase().from('os_sheet_snapshots').update({captured_at:snapshot.capturedAt,received_at:new Date().toISOString(),payload:snapshot}).eq('content_hash',hash).lt('captured_at',snapshot.capturedAt);
    if (error) throw error;
  }
  const {error} = await supabase().from('os_automation_connections').update({last_received_at:new Date().toISOString(),last_error:null}).eq('provider','google_sheets');
  if (error) throw error;
  res.json({received:true,changed:!insertError});
}));
incoming.post('/process',express.json({limit:'1kb'}),asyncRoute(async(req,res)=>{
  if (!await sheetAuthorization(req)) return res.sendStatus(401);
  background();res.json({accepted:true});
}));

const admin = express.Router();
admin.use(privateResponse,requireAdmin,sameOrigin);
admin.get('/',asyncRoute(async(_req,res)=>{
  const sb=supabase();
  const inboxColumns='id,source,account_id,external_id,conversation_id,source_at,source_text,draft,status,error_code,updated_at,created_at';
  const [connections,handled,snapshot] = await Promise.all([
    sb.from('os_automation_connections').select('provider,external_id,enabled,last_received_at,last_error').order('provider'),
    sb.from('os_sale_inbox').select(inboxColumns).in('status',['ignored','posted']).order('created_at',{ascending:false}).order('id').limit(100),
    sb.from('os_sheet_snapshots').select('payload,captured_at,received_at').eq('source_id',SHEET_ID).order('captured_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  for (const r of [connections,handled,snapshot]) if (r.error) throw r.error;
  const inbox=[];
  for (let offset=0;offset<10000;offset+=500) {
    const {data,error}=await sb.from('os_sale_inbox').select(inboxColumns).in('status',['pending','review']).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
    if(error)throw error;inbox.push(...data);if(data.length<500)break;
    if(offset===9500)throw safeError('Your inbox needs a larger reporting query. All messages are saved; none have been discarded.',503);
  }
  inbox.push(...(handled.data||[]));
  const sales=[];
  for (let offset=0;offset<10000;offset+=500) {
    const {data,error}=await sb.from('os_offsite_sales').select('*').order('sold_on',{ascending:false}).order('id').range(offset,offset+499);
    if (error) throw error;sales.push(...data);if(data.length<500)break;
    if(offset===9500)throw safeError('Sales reporting needs a larger reporting query. Your records are saved.',503);
  }
  const byProvider=new Map((connections.data||[]).map(c=>[c.provider,c]));
  const statuses=['google_sheets','instagram'].map(provider=>byProvider.get(provider)||{provider,external_id:provider==='instagram'?INSTAGRAM_USER:SHEET_ID,enabled:false,last_received_at:null,last_error:null});
  res.json({connections:statuses,inbox,handledInboxLimit:100,sales,summary:summarizeSales(sales),sheet:snapshot.data?{...snapshot.data.payload,sourceTitle:snapshot.data.payload.title,sourceUrl:'https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/edit',synced_at:snapshot.data.received_at}:null});
}));
admin.post('/inbox',asyncRoute(async(req,res)=>{
  if (typeof req.body.message!=='string' || !req.body.message.trim() || req.body.message.length>3000 || req.body.channel!=='in_person') throw safeError('Describe one in-person sale in 1–3,000 characters.');
  const sb=supabase();
  const {count,error:countError}=await sb.from('os_sale_inbox').select('id',{count:'exact',head:true}).eq('source','manual').gte('created_at',new Date(Date.now()-60000).toISOString());
  if(countError)throw countError;if(count>=5)throw safeError('Please wait a minute before adding more drafts.',429);
  const {data,error}=await sb.from('os_sale_inbox').insert({source:'manual',account_id:'owners',external_id:randomUUID(),source_text:req.body.message.trim(),source_at:new Date().toISOString()}).select('*').single();
  if(error)throw error;
  try{res.json(await prepareInbox(sb,data.id));}catch(_){res.json(data);}
}));
admin.post('/inbox/:id/prepare',asyncRoute(async(req,res)=>{
  if(!UUID.test(req.params.id))throw safeError('Choose a valid draft.');
  try{res.json(await prepareInbox(supabase(),req.params.id));}catch(error){throw safeError(error.message,error.status||502);}
}));
admin.post('/inbox/:id/confirm',asyncRoute(async(req,res)=>res.json(await confirmSale(supabase(),req.params.id,req.body))));
admin.post('/inbox/:id/dismiss',asyncRoute(async(req,res)=>res.json(await dismissInbox(supabase(),req.params.id,req.body.expected_updated_at))));
admin.post('/sheet-installer',asyncRoute(async(_req,res)=>{
  const existing=await connection('google_sheets');
  const previous=reconnectSecrets(existing);
  const secrets={token:previous.token||randomBytes(32).toString('base64url')};
  const {error}=await supabase().from('os_automation_connections').upsert({provider:'google_sheets',external_id:SHEET_ID,enabled:true,secret_ciphertext:seal(secrets),updated_at:new Date().toISOString()},{onConflict:'provider'});
  if(error)throw error;
  let script=fs.readFileSync(path.join(__dirname,'../integrations/google-sheets.gs'),'utf8');
  script=script.replaceAll('__SHEET_SYNC_ENDPOINT__',SITE+'/api/integrations/sheets').replaceAll('__PROCESS_ENDPOINT__',SITE+'/api/integrations/process').replaceAll('__SYNC_TOKEN__',secrets.token);
  res.json({script});
}));
admin.post('/connections/instagram',asyncRoute(async(req,res)=>{
  const {app_id,app_secret,access_token,account_id,username}=req.body||{};
  if(!/^\d{5,30}$/.test(app_id||'') || typeof app_secret!=='string' || app_secret.length<16 || app_secret.length>300 || typeof access_token!=='string' || access_token.length<20 || access_token.length>2000 || !/^\d{5,30}$/.test(account_id||'') || String(username||'').replace(/^@/,'').toLowerCase()!==INSTAGRAM_USER)throw safeError('Enter the Meta app details for @unknown.kickss in these private setup fields.');
  // This endpoint only verifies the account; the owner configures subscriptions in Meta.
  // No customer messages are sent by this application.
  const response=await fetch('https://graph.instagram.com/me?fields=user_id,username',{headers:{Authorization:'Bearer '+access_token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw safeError('Instagram could not verify that access token. Use the Instagram Login token for this business account.');
  const profile=await response.json();
  if(String(profile.user_id||profile.id)!==account_id || String(profile.username||'').toLowerCase()!==INSTAGRAM_USER)throw safeError('That token does not match @unknown.kickss. No connection was changed.');
  const old=await connection('instagram');
  const oldSecrets=reconnectSecrets(old);
  const verify_token=oldSecrets.verify_token||randomBytes(32).toString('base64url');
  // Access tokens are deliberately not persisted: verified webhooks use the app signing secret.
  const {error}=await supabase().from('os_automation_connections').upsert({provider:'instagram',external_id:account_id,enabled:true,config:{app_id,username:INSTAGRAM_USER},secret_ciphertext:seal({app_secret,verify_token}),updated_at:new Date().toISOString()},{onConflict:'provider'});
  if(error)throw error;
  res.json({webhook_url:SITE+'/api/integrations/instagram',verify_token,message:'Account verified. Add this callback and verification token in Meta, subscribe this account to messages, and send a real test DM.'});
}));
admin.post('/connections/:provider/pause',asyncRoute(async(req,res)=>{
  if(!['google_sheets','instagram'].includes(req.params.provider))throw safeError('Unknown connection.');
  const {error}=await supabase().from('os_automation_connections').update({enabled:false,updated_at:new Date().toISOString()}).eq('provider',req.params.provider);
  if(error)throw error;res.json({paused:true});
}));
module.exports={admin,incoming};
