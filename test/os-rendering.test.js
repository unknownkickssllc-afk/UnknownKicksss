const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { it } = require('node:test');
const vm = require('node:vm');

function dashboard(text = 'Synthetic record') {
  return {
    totals: { buyingCapacity: 10, businessDebt: 5, inventoryCost: 0 },
    members: [{ id: text, name: text }],
    accounts: [{ business_members: { name: text }, label: text, account_type: text, apr_percent: text, available_to_business: 10, business_balance: 5 }],
    deals: [{ deal_code: text, title: text, ownership_type: text, status: text, total_cost: 10 }],
    inventory: [],
    consignments: [{ item_name: text, partner_name: text, payout_status: text }],
    expenses: [{ expense_date: text, description: text, category: text, amount: 10 }],
    referralPrograms: [{ name: text }],
  };
}
function history(text = 'Synthetic reference') {
  return {
    records: ['capital','deals','consignment','inventory','expenses','referrals'].map((section,index) => ({ source_key:'test-'+index, section, title:text, reported_on:index ? '2026-01-02' : null, confidence:['user_reported','prior_extraction','derived','proposal'][index % 4], value_text:text, detail:text, source_ref:text, sort_order:index })),
    sheet: { importedAt:'2026-10-13T02:00:00Z', sourceTitle:text, sourceUrl:'https://example.com/test-sheet', periods:[], notes:[text], items:[{period:'Combined period',sourceRow:4,item:text,size:text,status:text,quantity:2,unitCost:null,salePrice:5,recordedProfit:null,purchaseDate:null,saleDate:null,notes:text}], expenses:[{sourceRow:8,description:text,amount:3,date:null,notes:text}] },
  };
}
async function harness(fetcher) {
  const html = await readFile(path.join(__dirname, '../server/views/os.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'The Business OS client script must exist');
  const elements = new Map();
  // Only create nodes present in the real markup, so missing selectors fail.
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  for (const match of markup.matchAll(/<[^>]*\bid=["']([^"']+)["'][^>]*>/g)) {
    const classes = new Set(match[0].match(/class="([^"]*)"/)?.[1].split(/\s+/) || []);
    elements.set('#'+match[1], { innerHTML:'',textContent:'',value:'',disabled:false,open:false,formValues:{},showModal(){this.open=true},close(){this.open=false},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle:(value,on)=>on?classes.add(value):classes.delete(value)} });
  }
  const requests = [];
  const context = vm.createContext({ URL, setTimeout:()=>1,clearTimeout:()=>{},FormData:class{constructor(form){this.values=form.formValues}get(key){return this.values[key]??null}has(key){return key in this.values}}, document:{querySelector:selector=>elements.get(selector)||null,querySelectorAll:()=>[]},async fetch(url,options){requests.push({url,options});return fetcher(url,options)} });
  await vm.runInContext(script, context, {timeout:1000});
  return {html,elements,requests,context};
}

it('renders current OS tables and historical sources safely without promoting history into balances', async () => {
  const attack = '\"><img src=x onerror="globalThis.compromised=true">&\'';
  const view = await harness(async url => ({ok:true,json:async()=>url==='/api/os/dashboard'?dashboard(attack):history(attack)}));
  assert.deepEqual(view.requests.map(request=>request.url), ['/api/os/dashboard','/api/os/history']);
  assert.equal(view.requests[1].options.cache,'no-store');
  assert.match(view.elements.get('#metric-grid').innerHTML,/Buying capacity/);
  assert.match(view.elements.get('#metric-grid').innerHTML,/\$10\.00/);
  assert.doesNotMatch(view.elements.get('#metric-grid').innerHTML,/&lt;img/,'Historical value text must not become a current balance');
  for (const selector of ['#capacity-table','#recent-deals','#funding-member','#funding-table','#deals-table','#consignment-table','#expenses-table','#referral-table','#history-capital','#history-deals','#history-consignment','#history-inventory','#history-expenses','#history-referrals','#sheet-items','#sheet-expense-history','#sheet-source']) {
    const rendered = view.elements.get(selector).innerHTML;
    assert.ok(rendered,selector+' must render data');
    assert.ok(!rendered.includes(attack),selector+' must escape stored markup');
    assert.doesNotMatch(rendered,/<img\b|<script\b/i,selector);
    assert.match(rendered,/&lt;img/,selector);
    assert.match(rendered,/&quot;/,selector);
    assert.match(rendered,/&amp;/,selector);
    assert.match(rendered,/&#39;/,selector);
  }
  assert.match(view.elements.get('#history-capital').innerHTML,/Report date not established/);
  assert.match(view.elements.get('#history-consignment').innerHTML,/Estimate · derived from source/);
  assert.match(view.elements.get('#history-inventory').innerHTML,/Proposal · not an active balance or rule/);
  assert.match(view.elements.get('#sheet-source').innerHTML,/Oct 12, 2026/,'Import dates use Eastern time');
  assert.match(view.elements.get('#sheet-items').innerHTML,/Snapshot quantity/);
  assert.match(view.elements.get('#sheet-items').innerHTML,/Not recorded/);
  assert.match(view.html,/not a confirmation that the item is still in stock today/);
  assert.equal(view.context.compromised,undefined);
});

it('rejects unsafe source links and distinguishes missing current records from zero balances', async () => {
  const data = history();data.sheet.sourceUrl='javascript:alert(1)';
  const current = dashboard();current.accounts=[];current.consignments=[];current.deals=[];current.expenses=[];
  const view = await harness(async url=>({ok:true,json:async()=>url==='/api/os/dashboard'?current:data}));
  assert.doesNotMatch(view.elements.get('#sheet-source').innerHTML,/href=|javascript:/);
  assert.match(view.elements.get('#sheet-source').innerHTML,/Synthetic reference/);
  assert.match(view.elements.get('#metric-grid').innerHTML,/No current records entered/);
  assert.doesNotMatch(view.elements.get('#metric-grid').innerHTML,/\$0\.00/);
});

it('reports history retrieval failures honestly and clears current plus historical data on session expiry', async () => {
  let mode='ok';
  const view=await harness(async url=>mode==='expired'?{ok:false,status:401,json:async()=>({error:'Unauthorized'})}:url==='/api/os/history'&&mode==='history-error'?{ok:false,status:503,json:async()=>({error:'Temporarily unavailable'})}:{ok:true,json:async()=>url==='/api/os/dashboard'?dashboard():history()});
  const prior=view.elements.get('#history-capital').innerHTML;
  mode='history-error';await view.elements.get('#refresh-btn').onclick();
  assert.equal(view.elements.get('#history-capital').innerHTML,prior);
  assert.match(view.elements.get('#history-warning').textContent,/last successfully loaded references/);
  assert.equal(view.elements.get('#history-warning').classList.contains('hidden'),false);
  mode='expired';await view.elements.get('#refresh-btn').onclick();
  for(const selector of ['#metric-grid','#history-capital','#sheet-items','#sheet-source'])assert.equal(view.elements.get(selector).innerHTML,'',selector+' clears on expiry');
  assert.equal(view.elements.get('#auth-warning').classList.contains('hidden'),false);
  assert.equal(view.elements.get('#refresh-btn').disabled,true);
});


it('finds imported items with filters and bounded pages', async()=>{
 const data=history();data.sheet.items=Array.from({length:45},(_,i)=>({...data.sheet.items[0],sourceKey:'item-'+i,item:'Shoe '+i,status:i%2?'sale recorded':'inventory snapshot'}));
 const view=await harness(async url=>({ok:true,json:async()=>url==='/api/os/dashboard'?dashboard():data}));
 assert.match(view.elements.get('#inventory-page-info').textContent,/Page 1 of 3/);
 assert.equal((view.elements.get('#sheet-items').innerHTML.match(/data-edit-kind=/g)||[]).length,20);
 view.elements.get('#inventory-search').value='Shoe 44';view.elements.get('#inventory-search').oninput();
 assert.match(view.elements.get('#inventory-page-info').textContent,/1 records/);
 assert.match(view.elements.get('#sheet-items').innerHTML,/Shoe 44/);
 assert.doesNotMatch(view.elements.get('#sheet-items').innerHTML,/Shoe 43/);
});

it('requires an explicit save and sends only edited historical fields with the original version',async()=>{
 const view=await harness(async url=>({ok:true,json:async()=>url==='/api/os/dashboard'?dashboard():history()}));
 vm.runInContext("openEditor('history:references','test-0')",view.context);
 assert.equal(view.elements.get('#record-dialog').open,true);
 assert.equal(view.requests.filter(r=>r.options.method==='PATCH').length,0);
 vm.runInContext('closeEditor()',view.context);
 assert.equal(view.elements.get('#record-dialog').open,false);
 vm.runInContext("openEditor('history:references','test-0')",view.context);
 view.elements.get('#record-form').formValues={title:'Synthetic reference',value_text:'Corrected value',reported_on:'',section:'capital',detail:'Synthetic reference'};
 await view.elements.get('#record-form').onsubmit({preventDefault(){}});
 const writes=view.requests.filter(r=>r.options.method==='PATCH');assert.equal(writes.length,1);
 assert.equal(writes[0].url,'/api/os/history/references/test-0');
 assert.deepEqual(JSON.parse(writes[0].options.body),{patch:{value_text:'Corrected value'},expectedUpdatedAt:null});
});

it('keeps conflicted edits open and clears stale profit when financial inputs change',async()=>{
 const data=history();data.sheet.items[0]={...data.sheet.items[0],sourceKey:'item-test',quantity:1,unitCost:10,salePrice:20,recordedProfit:10,status:'sale recorded',editing:{updatedAt:'2026-01-01T00:00:00Z',original:{unitCost:10}}};
 const view=await harness(async(url,opts)=>opts.method==='PATCH'?{ok:false,status:409,json:async()=>({error:'This record changed. Refresh before saving.'})}:{ok:true,json:async()=>url==='/api/os/dashboard'?dashboard():data});
 vm.runInContext("openEditor('history:items','item-test')",view.context);
 view.elements.get('#record-form').formValues={item:'Synthetic reference',size:'Synthetic reference',status:'sale recorded',quantity:'1',unitCost:'12',salePrice:'20',recordedProfit:'10',purchaseDate:'',saleDate:'',notes:'Synthetic reference'};
 await view.elements.get('#record-form').onsubmit({preventDefault(){}});
 const patch=JSON.parse(view.requests.find(r=>r.options.method==='PATCH').options.body);assert.deepEqual(patch.patch,{unitCost:12,recordedProfit:null});
 assert.equal(patch.expectedUpdatedAt,'2026-01-01T00:00:00Z');assert.equal(view.elements.get('#record-dialog').open,true);
 assert.match(view.elements.get('#dialog-error').textContent,/Close this form, refresh/);
});

it('AI preparation only requests a draft and escapes model output before review',async()=>{
 const malicious='<img src=x onerror=alert(1)>';
 const view=await harness(async url=>({ok:true,json:async()=>url.endsWith('/assistant/draft')?{summary:malicious,questions:[malicious],draft:{kind:'expense',fields:{description:malicious,amount:25,category:'other',expense_date:null}}}:url==='/api/os/dashboard'?dashboard():history()}));
 view.elements.get('#assistant-message').value='Expense of $25';await view.elements.get('#assistant-form').onsubmit({preventDefault(){}});
 assert.equal(view.requests.filter(r=>r.options.method==='POST').length,1);assert.equal(view.requests.at(-1).url,'/api/os/assistant/draft');
 assert.doesNotMatch(view.elements.get('#assistant-result').innerHTML,/<img/);assert.match(view.elements.get('#assistant-result').innerHTML,/&lt;img/);
 vm.runInContext('reviewDraft()',view.context);assert.equal(view.elements.get('#record-dialog').open,true);assert.equal(view.requests.filter(r=>r.options.method==='POST').length,1);
});
