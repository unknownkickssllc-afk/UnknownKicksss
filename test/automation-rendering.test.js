const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { it } = require('node:test');

const version = '2026-10-13T12:00:00.123456+00:00';
const fixture = () => ({
  connections:[{provider:'instagram',external_id:'fixture-account',enabled:true,last_received_at:'2026-10-13T15:00:00Z',last_error:null},{provider:'google_sheets',enabled:false,last_received_at:null,last_error:null}],
  inbox:[{id:'inbox/one',source:'instagram',source_text:'Synthetic buyer paid $100 for a hoodie.',created_at:'2026-10-13T15:00:00Z',updated_at:version,status:'pending',draft:{summary:'Sale draft awaiting review',questions:['What did the item cost?'],fields:{item:'Hoodie',quantity:1,sale_total:100,cost_total:null,fees_total:0,sold_on:'2026-10-13',channel:'instagram',payment_reference:null,notes:'Synthetic note'}}}],
  sales:[{id:'sale1',channel:'in_person',item:'Synthetic sale',quantity:2,sale_total:40,cost_total:null,fees_total:0,sold_on:'2026-10-12'}],
  summary:{sales:1,units:2,revenue:40,profit:null,marginPercent:null,knownProfit:0,missingCostCount:1,missingFeeCount:0,daily:[{date:'2026-10-12',sales:1,revenue:40,profit:null}]},
  sheet:{sourceTitle:'Synthetic sheet',sourceUrl:'https://docs.google.com/spreadsheets/d/fixture',synced_at:'2026-10-13T16:00:00Z',periods:[{label:'Combined period',revenue:999,recordedProfit:100,purchaseCost:899,rowCount:5}],notes:['Original source periods retained']},
});
const response = (body, status = 200) => ({ok:status>=200&&status<300,status,json:async()=>body});
const event = () => ({preventDefault(){}});
const tick = () => new Promise(resolve=>setImmediate(resolve));

async function harness(fetcher = async()=>response(fixture())) {
  const html = await fs.readFile(path.join(__dirname,'../server/views/automation.html'),'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const markup=html.replace(/<script>[\s\S]*?<\/script>/g,''), elements=new Map();
  for(const match of markup.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const classes=new Set(match[0].match(/class="([^"]*)"/)?.[1].split(/\s+/)||[]);
    elements.set('#'+match[2],{
      tagName:match[1],innerHTML:'',textContent:'',value:match[0].match(/\bvalue="([^"]*)"/)?.[1]||'',checked:false,disabled:false,open:false,listeners:{},
      addEventListener(name,handler){this.listeners[name]=handler;},
      showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},select(){this.selected=true;},
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
    });
  }
  elements.get('#inbox-filter').value='open';
  const requests=[],intervals=[],documentListeners={},windowListeners={},redirects=[],clipboard=[];
  const document={hidden:false,querySelector:selector=>elements.get(selector)||null,
    querySelectorAll:selector=>[...elements.values()].filter(element=>selector.split(',').includes(element.tagName)),
    addEventListener(name,handler){documentListeners[name]=handler;}};
  const context=vm.createContext({document,URL,navigator:{clipboard:{async writeText(value){clipboard.push(value);}}},
    window:{location:{replace:target=>redirects.push(target)},addEventListener(name,handler){windowListeners[name]=handler;}},
    setInterval(handler,ms){intervals.push({handler,ms});return intervals.length;},
    async fetch(url,options){requests.push({url,options});return fetcher(url,options);},
  });
  const initial=vm.runInContext(script,context,{timeout:1000});
  return {html,context,elements,requests,intervals,document,documentListeners,windowListeners,redirects,clipboard,initial};
}
function fillSale(view, overrides={}) {
  const values={'#sale-item':'Hoodie','#sale-channel':'instagram','#sale-date':'2026-10-13','#sale-quantity':'1','#sale-total':'100','#sale-cost':'','#sale-fees':'0','#sale-reference':'','#sale-notes':'Synthetic note',...overrides};
  Object.entries(values).forEach(([key,value])=>{view.elements.get(key).value=value;});
  view.elements.get('#payment-confirmed').checked=true;
  view.elements.get('#duplicate-checked').checked=true;
}

it('renders escaped source evidence and keeps confirmed sales separate from sheet period totals',async()=>{
  const data=fixture(),attack='\"><img src=x onerror="globalThis.compromised=true">&\'';
  data.inbox[0].source_text=attack;data.inbox[0].draft.fields.item=attack;data.inbox[0].draft.summary=attack;data.inbox[0].draft.questions=[attack];
  data.sales[0].item=attack;data.sheet.sourceTitle=attack;data.sheet.periods[0].label=attack;data.connections[0].external_id=attack;
  data.sheet.sourceUrl='javascript:alert(1)';
  const view=await harness(async()=>response(data));await view.initial;
  assert.equal(view.requests[0].url,'/api/os/automation');
  assert.equal(view.requests[0].options.credentials,'same-origin');assert.equal(view.requests[0].options.cache,'no-store');
  for(const selector of ['#inbox-list','#sales-table','#sheet-source','#sheet-periods','#connection-status']){
    const markup=view.elements.get(selector).innerHTML;assert.doesNotMatch(markup,/<img|onerror="global/);assert.match(markup,/&lt;img/);assert.match(markup,/&amp;/);
  }
  assert.doesNotMatch(view.elements.get('#sheet-source').innerHTML,/href=|javascript:/);
  assert.match(view.elements.get('#sale-metrics').innerHTML,/\$40\.00/);assert.doesNotMatch(view.elements.get('#sale-metrics').innerHTML,/999|1,039/);
  assert.match(view.elements.get('#sheet-metrics').innerHTML,/\$999\.00/);
  assert.match(view.elements.get('#sale-metrics').innerHTML,/Needs details/);assert.match(view.elements.get('#daily-table').innerHTML,/Needs details/);
  assert.match(view.elements.get('#daily-table').innerHTML,/Oct 12, 2026/,'Date-only sale dates must not shift in Eastern time');
  assert.match(view.elements.get('#sales-trend').innerHTML,/aria-hidden="true"/);
  assert.match(view.html,/Spreadsheet totals are never added/);assert.match(view.html,/Read-only view/);assert.equal(view.context.compromised,undefined);
});

it('requires payment and duplicate checks, then posts explicit reviewed fields and preserves unknown versus zero',async()=>{
  const view=await harness(async(url,options)=>response(options.method==='POST'?{ok:true}:fixture()));await view.initial;
  vm.runInContext("openReview('inbox/one')",view.context);fillSale(view);
  view.elements.get('#payment-confirmed').checked=false;
  await view.elements.get('#sale-form').listeners.submit(event());assert.match(view.elements.get('#sale-error').textContent,/payment was actually received/);
  view.elements.get('#payment-confirmed').checked=true;view.elements.get('#duplicate-checked').checked=false;
  await view.elements.get('#sale-form').listeners.submit(event());assert.match(view.elements.get('#sale-error').textContent,/not counted twice/);
  assert.equal(view.requests.filter(request=>request.options.method==='POST').length,0);
  view.elements.get('#duplicate-checked').checked=true;
  await view.elements.get('#sale-form').listeners.submit(event());
  const posts=view.requests.filter(request=>request.options.method==='POST');assert.equal(posts.length,1);
  assert.equal(posts[0].url,'/api/os/automation/inbox/inbox%2Fone/confirm');
  assert.deepEqual(JSON.parse(posts[0].options.body),{expected_updated_at:version,payment_confirmed:true,channel:'instagram',item:'Hoodie',quantity:1,sale_total:100,cost_total:null,fees_total:0,sold_on:'2026-10-13',payment_reference:null,notes:'Synthetic note'});
  assert.equal(view.elements.get('#sale-dialog').open,false);assert.match(view.elements.get('#page-success').textContent,/Paid sale recorded/);
});

it('rejects invalid sale fields without posting and retains a conflicted review with all owner inputs',async()=>{
  const view=await harness(async(url,options)=>options.method==='POST'?response({error:'Another owner updated this draft.'},409):response(fixture()));await view.initial;
  vm.runInContext("openReview('inbox/one')",view.context);
  for(const [key,value] of [['#sale-quantity','1.5'],['#sale-date','2026-02-30'],['#sale-total','12.345'],['#sale-cost','-1'],['#sale-fees','NaN'],['#sale-channel','website']]){
    fillSale(view,{[key]:value});await view.elements.get('#sale-form').listeners.submit(event());
    assert.equal(view.requests.filter(request=>request.options.method==='POST').length,0,key);
  }
  fillSale(view,{'#sale-notes':'Do not lose this note'});await view.elements.get('#sale-form').listeners.submit(event());
  assert.equal(view.elements.get('#sale-dialog').open,true);assert.equal(view.elements.get('#sale-notes').value,'Do not lose this note');
  assert.match(view.elements.get('#sale-error').textContent,/Another owner/);assert.match(view.elements.get('#sale-error').textContent,/refresh and reopen/);
  assert.equal(view.elements.get('#confirm-sale').disabled,false);
});

it('prepares, ignores, and creates inbox entries without automatically confirming a sale',async()=>{
  const view=await harness(async(url,options)=>response(options.method==='POST'?{id:'new'}:fixture()));await view.initial;
  await vm.runInContext("inboxAction('prepare','inbox/one')",view.context);
  await vm.runInContext("inboxAction('dismiss','inbox/one')",view.context);
  view.elements.get('#quick-message').value='Paid in person, details need review';
  await view.elements.get('#quick-entry-form').listeners.submit(event());
  const posts=view.requests.filter(request=>request.options.method==='POST');
  assert.deepEqual(posts.map(request=>request.url),['/api/os/automation/inbox/inbox%2Fone/prepare','/api/os/automation/inbox/inbox%2Fone/dismiss','/api/os/automation/inbox']);
  assert.deepEqual(JSON.parse(posts[1].options.body),{expected_updated_at:version});
  assert.deepEqual(JSON.parse(posts[2].options.body),{message:'Paid in person, details need review',channel:'in_person'});
  assert.equal(view.elements.get('#quick-message').value,'');
});

it('serializes refreshes and pauses background polling while a review is open or the page is hidden',async()=>{
  let release,active=0,maxActive=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const view=await harness(async()=>{active++;maxActive=Math.max(maxActive,active);await gate;active--;return response(fixture());});
  assert.equal(view.intervals[0].ms,30000);view.intervals[0].handler();view.windowListeners.focus();assert.equal(view.requests.length,1);
  release();await view.initial;assert.equal(maxActive,1);
  vm.runInContext("openReview('inbox/one')",view.context);fillSale(view,{'#sale-item':'Unsaved corrected item'});
  const before=view.requests.length;view.intervals[0].handler();await view.elements.get('#refresh').listeners.click();
  assert.equal(view.requests.length,before);assert.equal(view.elements.get('#sale-item').value,'Unsaved corrected item');
  assert.match(view.elements.get('#update-status').textContent,/paused/);
  vm.runInContext('closeReview()',view.context);view.document.hidden=true;view.intervals[0].handler();await view.windowListeners.focus();assert.equal(view.requests.length,before);
  view.document.hidden=false;view.documentListeners.visibilitychange();await tick();assert.equal(view.requests.length,before+1);
});

it('clears all private content and connection secrets on 401 and does not resume polling',async()=>{
  let expired=false;
  const view=await harness(async()=>expired?response({error:'Unauthorized'},401):response(fixture()));await view.initial;
  view.elements.get('#instagram-app-secret').value='private-app-secret';view.elements.get('#instagram-access-token').value='private-token';view.elements.get('#instagram-verify-token').value='private-verify-token';view.elements.get('#installer-script').value='private-installer';view.elements.get('#quick-message').value='private source';
  expired=true;await view.elements.get('#refresh').listeners.click();
  for(const selector of ['#inbox-list','#sales-table','#sheet-periods','#connection-status'])assert.equal(view.elements.get(selector).innerHTML,'');
  for(const selector of ['#instagram-app-secret','#instagram-access-token','#instagram-verify-token','#installer-script','#quick-message'])assert.equal(view.elements.get(selector).value,'');
  assert.deepEqual(view.redirects,['/admin/']);assert.equal(view.elements.get('#auth-warning').classList.contains('hidden'),false);
  const before=view.requests.length;view.intervals[0].handler();await view.windowListeners.focus();assert.equal(view.requests.length,before);
});

it('keeps installer secrets in the private textarea, copies only on request, and clears them when leaving',async()=>{
  const secret='PRIVATE-SETUP-KEY <script>do not run</script>';
  const view=await harness(async(url,options)=>response(url.endsWith('/sheet-installer')?{script:secret}:fixture()));await view.initial;
  await view.elements.get('#sheet-installer').listeners.click();
  assert.equal(view.elements.get('#installer-script').value,secret);assert.equal(view.clipboard.length,0);
  for(const element of view.elements.values())assert.ok(!element.innerHTML.includes('PRIVATE-SETUP-KEY'));
  assert.deepEqual(JSON.parse(view.requests.find(request=>request.url.endsWith('/sheet-installer')).options.body),{});
  await view.elements.get('#copy-installer').listeners.click();assert.deepEqual(view.clipboard,[secret]);
  view.windowListeners.pagehide();assert.equal(view.elements.get('#installer-script').value,'');assert.equal(view.elements.get('#installer-result').classList.contains('hidden'),true);
});

it('never prefills returned Instagram secrets and clears submitted credentials after a successful connection',async()=>{
  const data=fixture();data.connections[0].access_token='saved-token';data.connections[0].app_secret='saved-secret';
  const view=await harness(async(url,options)=>response(options.method==='POST'?{ok:true}:data));await view.initial;
  assert.equal(view.elements.get('#instagram-app-secret').value,'');assert.equal(view.elements.get('#instagram-access-token').value,'');
  assert.doesNotMatch(view.elements.get('#connection-status').innerHTML,/saved-token|saved-secret/);
  const values={'#instagram-app-id':'app-1','#instagram-app-secret':'new-secret','#instagram-access-token':'new-token','#instagram-account-id':'account-1','#instagram-username':'unknown.kickss'};
  Object.entries(values).forEach(([key,value])=>{view.elements.get(key).value=value;});
  await view.elements.get('#instagram-form').listeners.submit(event());
  const post=view.requests.find(request=>request.url.endsWith('/connections/instagram'));
  assert.deepEqual(JSON.parse(post.options.body),{app_id:'app-1',app_secret:'new-secret',access_token:'new-token',account_id:'account-1',username:'unknown.kickss'});
  assert.equal(view.elements.get('#instagram-app-secret').value,'');assert.equal(view.elements.get('#instagram-access-token').value,'');
});

it('shows Meta callback setup privately and clears the verification token when leaving',async()=>{
  const token='PRIVATE-VERIFICATION-TOKEN';
  const view=await harness(async(url,options)=>response(options.method==='POST'?{webhook_url:'https://www.unknownkickss.co/api/integrations/instagram',verify_token:token,message:'Subscribe the account to messages.'}:fixture()));await view.initial;
  const values={'#instagram-app-id':'123456','#instagram-app-secret':'app-secret','#instagram-access-token':'access-token','#instagram-account-id':'654321','#instagram-username':'unknown.kickss'};
  Object.entries(values).forEach(([key,value])=>{view.elements.get(key).value=value;});
  await view.elements.get('#instagram-form').listeners.submit(event());
  assert.equal(view.elements.get('#instagram-webhook-url').value,'https://www.unknownkickss.co/api/integrations/instagram');
  assert.equal(view.elements.get('#instagram-verify-token').value,token);assert.equal(view.elements.get('#instagram-setup-result').classList.contains('hidden'),false);
  assert.match(view.elements.get('#instagram-setup-message').textContent,/Subscribe/);assert.match(view.html,/subscribe|Subscribe/);assert.match(view.html,/installUnknownKickssSync/);
  assert.equal(view.clipboard.length,0);for(const element of view.elements.values())assert.ok(!element.innerHTML.includes(token));
  await view.elements.get('#copy-instagram-token').listeners.click();assert.deepEqual(view.clipboard,[token]);
  view.windowListeners.pagehide();assert.equal(view.elements.get('#instagram-verify-token').value,'');assert.equal(view.elements.get('#instagram-webhook-url').value,'');assert.equal(view.elements.get('#instagram-setup-result').classList.contains('hidden'),true);
});

it('offers manual review for unprepared entries and pauses only explicitly selected connections',async()=>{
  const data=fixture();data.inbox[0].source='manual';data.inbox[0].draft={};data.inbox[0].status='pending';
  const view=await harness(async(url,options)=>response(options.method==='POST'?{paused:true}:data));await view.initial;
  assert.match(view.elements.get('#inbox-list').innerHTML,/In person/);assert.match(view.elements.get('#inbox-list').innerHTML,/Enter details/);
  vm.runInContext("openReview('inbox/one')",view.context);assert.equal(view.elements.get('#sale-dialog').open,true);assert.equal(view.elements.get('#sale-total').value,'');
  vm.runInContext('closeReview()',view.context);assert.match(view.elements.get('#connection-status').innerHTML,/data-pause-provider="instagram"/);
  await vm.runInContext("pauseConnection('instagram')",view.context);
  const writes=view.requests.filter(request=>request.options.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/os/automation/connections/instagram/pause');assert.deepEqual(JSON.parse(writes[0].options.body),{});
});

it('makes failed AI preparation reviewable without exposing provider error details',async()=>{
  const data=fixture();data.inbox[0].status='review';data.inbox[0].draft={};data.inbox[0].error_code='untrusted-private-provider-error';
  const view=await harness(async()=>response(data));await view.initial;
  const markup=view.elements.get('#inbox-list').innerHTML;
  assert.match(markup,/latest AI attempt did not finish/);assert.match(markup,/Enter details/);assert.doesNotMatch(markup,/untrusted-private-provider-error/);
  vm.runInContext("openReview('inbox/one')",view.context);assert.equal(view.elements.get('#sale-dialog').open,true);
});

it('keeps more than 100 actionable entries accessible and discloses the handled-history limit',async()=>{
  const data=fixture(),original=data.inbox[0];data.handledInboxLimit=100;
  data.inbox=Array.from({length:110},(_,index)=>({...original,id:'pending-'+index,source_text:'Pending source '+index}));
  data.inbox.push({...original,id:'posted-old',status:'posted',source_text:'Posted source'});
  const view=await harness(async()=>response(data));await view.initial;
  assert.equal(view.elements.get('#inbox-count').textContent,'110');assert.match(view.elements.get('#inbox-list').innerHTML,/Pending source 109/);
  assert.equal((view.elements.get('#inbox-list').innerHTML.match(/class="inbox-row"/g)||[]).length,110);
  assert.match(view.elements.get('#inbox-scope').textContent,/100 most recent handled entries/);
  view.elements.get('#inbox-filter').value='confirmed';view.elements.get('#inbox-filter').listeners.change();
  assert.match(view.elements.get('#inbox-list').innerHTML,/Posted source/);assert.doesNotMatch(view.elements.get('#inbox-list').innerHTML,/Pending source/);
});

it('shows backend spreadsheet warnings and flags incomplete revenue and purchase-cost totals',async()=>{
  const data=fixture();data.sheet.warnings=['Missing quantities are excluded.','Payment receipt is unverified.'];data.sheet.periods[0].revenueIncomplete=true;data.sheet.periods[0].purchaseCostIncomplete=true;
  const view=await harness(async()=>response(data));await view.initial;
  assert.match(view.elements.get('#sheet-notes').textContent,/Missing quantities/);assert.match(view.elements.get('#sheet-notes').textContent,/receipt is unverified/);
  assert.match(view.elements.get('#sheet-metrics').innerHTML,/Sheet sales \(partial\)/);assert.match(view.elements.get('#sheet-metrics').innerHTML,/Purchase costs \(partial\)/);
  assert.equal((view.elements.get('#sheet-periods').innerHTML.match(/Incomplete/g)||[]).length,2);
});

it('keeps source data on refresh errors and preserves actionable mutation errors after a successful refresh',async()=>{
  let failReads=false;
  const view=await harness(async(url,options)=>options.method==='POST'?response({error:'The connection needs attention.'},503):failReads?response({error:'Temporarily unavailable'},503):response(fixture()));await view.initial;
  const previous=view.elements.get('#inbox-list').innerHTML;failReads=true;await view.elements.get('#refresh').listeners.click();
  assert.equal(view.elements.get('#inbox-list').innerHTML,previous);assert.match(view.elements.get('#page-error').textContent,/previous data/);
  failReads=false;await view.elements.get('#refresh').listeners.click();assert.equal(view.elements.get('#page-error').classList.contains('hidden'),true);
  await vm.runInContext("inboxAction('prepare','inbox/one')",view.context);
  assert.equal(view.elements.get('#page-error').classList.contains('hidden'),false);assert.match(view.elements.get('#page-error').textContent,/connection needs attention/);
});

it('shows honest empty and incomplete sheet states without fabricating zero sales or profit',async()=>{
  const data={connections:[],inbox:[],sales:[],summary:{sales:0,units:0,revenue:0,profit:null,marginPercent:null,daily:[]},sheet:null};
  const view=await harness(async()=>response(data));await view.initial;
  assert.match(view.elements.get('#inbox-list').innerHTML,/caught up/);assert.match(view.elements.get('#sales-trend').innerHTML,/first confirmed sale/);
  assert.equal(view.elements.get('#sheet-metrics').innerHTML,'');assert.match(view.elements.get('#sheet-source').textContent,/No live spreadsheet update/);
  assert.match(view.elements.get('#connection-status').innerHTML,/Not connected/);
  data.sheet={payload:{periods:[{label:'Unknown profit',revenue:20,recordedProfit:null,purchaseCost:10,rowCount:1,profitIncomplete:true}]},source_title:'Sheet',imported_at:'2026-10-13T16:00:00Z'};
  await view.elements.get('#refresh').listeners.click();
  assert.match(view.elements.get('#sheet-metrics').innerHTML,/Recorded profit \(partial\)/);assert.match(view.elements.get('#sheet-metrics').innerHTML,/Not recorded/);
  assert.match(view.elements.get('#sheet-notes').textContent,/missing/);
});
