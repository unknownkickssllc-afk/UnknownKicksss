class SaleInboxError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new SaleInboxError(status, message); };
const FIELDS = ['channel','item','quantity','sale_total','cost_total','fees_total','sold_on','payment_reference','notes'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idInput(id) { if (typeof id !== 'string' || !UUID.test(id)) fail('Choose a valid inbox record.'); return id; }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('Refresh the record before saving.');
  return value;
}
function money(value, nullable, positive, label) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9999999999.99 || (positive && value === 0) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) fail(label + ' must be a valid amount with at most two decimal places.');
  return value;
}
function validateSale(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => ![...FIELDS,'expected_updated_at','payment_confirmed'].includes(key))) fail('Send the sale details shown in the review form.');
  if (body.payment_confirmed !== true) fail('Confirm that payment was received before recording this sale.');
  timestamp(body.expected_updated_at);
  if (!['instagram','in_person'].includes(body.channel)) fail('Choose Instagram or in person.');
  if (typeof body.item !== 'string' || !body.item.trim() || body.item.trim().length > 500) fail('An item name is required (up to 500 characters).');
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 100000) fail('Quantity must be a positive whole number.');
  const soldOn = body.sold_on;
  if (typeof soldOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(soldOn) || !Number.isFinite(Date.parse(soldOn)) || new Date(soldOn).toISOString().slice(0,10) !== soldOn) fail('Enter the actual sale date.');
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 6000)) fail('Notes must be text up to 6,000 characters.');
  if (body.payment_reference != null && (typeof body.payment_reference !== 'string' || body.payment_reference.length > 200)) fail('Payment reference must be text up to 200 characters.');
  const reference = body.payment_reference?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
  return { channel:body.channel, item:body.item.trim(), quantity:body.quantity,
    sale_total:money(body.sale_total,false,true,'Sale total'), cost_total:money(body.cost_total ?? null,true,false,'Total cost'), fees_total:money(body.fees_total ?? null,true,false,'Fees'),
    sold_on:soldOn, payment_reference:reference, notes:body.notes?.trim() || '' };
}
function databaseError(error) {
  if (error?.code === 'P0001') fail('A matching sale from this Instagram conversation is already recorded. If this is a separate sale, enter its unique payment reference.',409);
  if (error?.code === 'P0002') fail('This inbox record no longer exists.',404);
  if (error?.code === '40001') fail('This sale changed or was already recorded with different details. Refresh before continuing.',409);
  if (error?.code === '23505') fail('That payment reference is already recorded. Check the existing sale before continuing.',409);
  if (['22023','23514','23502','22P02','22007','22008'].includes(error?.code)) fail('Review the sale details and try again.');
  throw error;
}
async function confirmSale(sb,id,body) {
  idInput(id);
  const sale = validateSale(body);
  const { data, error } = await sb.rpc('os_confirm_offsite_sale', { p_inbox_id:id, p_expected_updated_at:body.expected_updated_at, p_sale:sale });
  if (error) databaseError(error);
  return data;
}
async function dismissInbox(sb,id,expectedUpdatedAt) {
  idInput(id); timestamp(expectedUpdatedAt);
  const next = new Date(Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1)).toISOString();
  const { data,error } = await sb.from('os_sale_inbox').update({status:'ignored',updated_at:next,processing_until:null})
    .eq('id',id).eq('updated_at',expectedUpdatedAt).in('status',['pending','review']).select('id,source,account_id,external_id,conversation_id,source_at,source_text,draft,status,error_code,updated_at,created_at,processing_until').maybeSingle();
  if (error) databaseError(error);
  if (!data) fail('This inbox record changed. Refresh before continuing.',409);
  return data;
}
const cents = value => Math.round(Number(value) * 100);
const knownAmount = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
function groupTotals(rows) {
  let revenue = 0, knownProfit = 0, knownRevenue = 0, missingCostCount = 0, missingFeeCount = 0;
  for (const row of rows) {
    const amount = cents(row.sale_total); revenue += amount;
    if (!knownAmount(row.cost_total)) missingCostCount++;
    if (!knownAmount(row.fees_total)) missingFeeCount++;
    if (knownAmount(row.cost_total) && knownAmount(row.fees_total)) { knownRevenue += amount; knownProfit += amount - cents(row.cost_total) - cents(row.fees_total); }
  }
  const complete = rows.length > 0 && missingCostCount === 0 && missingFeeCount === 0;
  return { sales:rows.length,units:rows.reduce((sum,row)=>sum + Number(row.quantity),0),revenue:revenue/100,
    profit:complete?knownProfit/100:null,marginPercent:complete&&revenue?Math.round(10000*knownProfit/revenue)/100:null,
    knownProfit:knownProfit/100,knownRevenue:knownRevenue/100,missingCostCount,missingFeeCount };
}
function summarizeSales(sales = []) {
  const rows = sales.filter(row=>row && row.confirmed_at && /^\d{4}-\d{2}-\d{2}$/.test(row.sold_on));
  const daily = [...new Set(rows.map(row=>row.sold_on))].sort().map(date=>({date,...groupTotals(rows.filter(row=>row.sold_on===date))}));
  const channels = [...new Set(rows.map(row=>row.channel))].sort().map(channel=>({channel,...groupTotals(rows.filter(row=>row.channel===channel))}));
  return {...groupTotals(rows),daily,channels};
}
module.exports = { SaleInboxError, validateSale, confirmSale, dismissInbox, summarizeSales };
