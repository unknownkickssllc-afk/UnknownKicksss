let state=null;
const $=(s)=>document.querySelector(s);
const money=(n)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n||0));
function table(headers,rows){if(!rows.length)return '<p class="muted">Nothing here yet.</p>';return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>'}
async function api(path,opts={}){const r=await fetch(path,{headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'Request failed');e.status=r.status;throw e}return j}
function membersByName(name){return state.members.find(m=>m.name.toLowerCase()===name.toLowerCase())}
function render(){
 const t=state.totals;
 $('#metric-grid').innerHTML=[
  ['Buying capacity',money(t.buyingCapacity)],['Business debt tracked',money(t.businessDebt)],['Inventory cost tied up',money(t.inventoryCost)],
  ['Pending consignment',money(t.pendingConsignmentPayout)],['Active consignment potential',money(t.activeConsignmentPayout)],['Operating expenses logged',money(t.operatingExpenses)]
 ].map(([l,v])=>'<div class="metric"><span>'+l+'</span><strong>'+v+'</strong></div>').join('');
 $('#capacity-table').innerHTML=table(['Partner','Source','Available','Business balance'],state.accounts.map(a=>'<tr><td>'+(a.business_members?.name||'Business')+'</td><td>'+a.label+'</td><td>'+money(a.available_to_business)+'</td><td>'+money(a.business_balance)+'</td></tr>'));
 $('#consignment-summary').innerHTML='<div class="metric"><span>Pending + active expected</span><strong>'+money(t.pendingConsignmentPayout+t.activeConsignmentPayout)+'</strong></div>';
 $('#recent-deals').innerHTML=table(['Deal','Type','Cost','Status'],state.deals.slice(0,8).map(d=>'<tr><td>'+d.deal_code+' — '+d.title+'</td><td>'+d.ownership_type+'</td><td>'+money(d.total_cost)+'</td><td><span class="pill">'+d.status+'</span></td></tr>'));
 const options=state.members.map(m=>'<option value="'+m.id+'">'+m.name+'</option>').join('');$('#funding-member').innerHTML=options;
 $('#funding-table').innerHTML=table(['Partner','Label','Type','Available','Debt','APR'],state.accounts.map(a=>'<tr><td>'+(a.business_members?.name||'—')+'</td><td>'+a.label+'</td><td>'+a.account_type+'</td><td>'+money(a.available_to_business)+'</td><td>'+money(a.business_balance)+'</td><td>'+(a.apr_percent??'—')+'</td></tr>'));
 $('#deals-table').innerHTML=table(['Code','Title','Ownership','Cost','Status'],state.deals.map(d=>'<tr><td>'+d.deal_code+'</td><td>'+d.title+'</td><td>'+d.ownership_type+'</td><td>'+money(d.total_cost)+'</td><td>'+d.status+'</td></tr>'));
 $('#consignment-table').innerHTML=table(['Item','Store','Cost','List','Payout','Status'],state.consignments.map(c=>'<tr><td>'+c.item_name+'</td><td>'+(c.partner_name||'—')+'</td><td>'+money(c.original_cost)+'</td><td>'+money(c.list_price)+'</td><td>'+money(c.expected_payout)+'</td><td>'+c.payout_status+'</td></tr>'));
 $('#expenses-table').innerHTML=table(['Date','Description','Category','Amount'],state.expenses.map(e=>'<tr><td>'+e.expense_date+'</td><td>'+e.description+'</td><td>'+e.category+'</td><td>'+money(e.amount)+'</td></tr>'));
 $('#referral-table').innerHTML=table(['Program','Customer off','Referrer','Min profit'],state.referralPrograms.map(r=>'<tr><td>'+r.name+'</td><td>'+money(r.customer_discount)+'</td><td>'+money(r.referrer_reward)+'</td><td>'+money(r.min_pre_promo_profit)+'</td></tr>'));
}
async function load(){
 $('#auth-warning').classList.add('hidden');$('#schema-warning').classList.add('hidden');
 try{state=await api('/api/os/dashboard');render()}
 catch(e){if(e.status===401){$('#auth-warning').classList.remove('hidden')}else{$('#schema-warning').textContent='OS database tables are not active yet. Run supabase/os_v1.sql in Supabase, then refresh. '+e.message;$('#schema-warning').classList.remove('hidden')}}
}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.nav,.section').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.section).classList.add('active');$('#section-title').textContent=b.textContent.trim()}));
$('#refresh-btn').onclick=load;
function obj(form){return Object.fromEntries(new FormData(form).entries())}
$('#funding-form').onsubmit=async e=>{e.preventDefault();const d=obj(e.target);d.legacy=e.target.legacy.checked;await api('/api/os/funding-accounts',{method:'POST',body:JSON.stringify(d)});e.target.reset();load()};
$('#deal-form').onsubmit=async e=>{e.preventDefault();const d=obj(e.target),j=membersByName('Jahson'),m=membersByName('Jamal'),cost=Number(d.total_cost||0);d.contributions=[];if(j&&d.jahson_percent)d.contributions.push({member_id:j.id,amount:cost*Number(d.jahson_percent)/100,ownership_percent:Number(d.jahson_percent)});if(m&&d.jamal_percent)d.contributions.push({member_id:m.id,amount:cost*Number(d.jamal_percent)/100,ownership_percent:Number(d.jamal_percent)});delete d.jahson_percent;delete d.jamal_percent;await api('/api/os/deals',{method:'POST',body:JSON.stringify(d)});e.target.reset();load()};
$('#consignment-form').onsubmit=async e=>{e.preventDefault();await api('/api/os/consignments',{method:'POST',body:JSON.stringify(obj(e.target))});e.target.reset();load()};
$('#expense-form').onsubmit=async e=>{e.preventDefault();const d=obj(e.target),j=membersByName('Jahson'),m=membersByName('Jamal'),amount=Number(d.amount||0);d.splits=[];if(j&&d.jahson_percent)d.splits.push({member_id:j.id,amount:amount*Number(d.jahson_percent)/100,split_percent:Number(d.jahson_percent)});if(m&&d.jamal_percent)d.splits.push({member_id:m.id,amount:amount*Number(d.jamal_percent)/100,split_percent:Number(d.jamal_percent)});delete d.jahson_percent;delete d.jamal_percent;await api('/api/os/expenses',{method:'POST',body:JSON.stringify(d)});e.target.reset();load()};
$('#referral-form').onsubmit=async e=>{e.preventDefault();await api('/api/os/referral-programs',{method:'POST',body:JSON.stringify(obj(e.target))});e.target.reset();load()};
load();