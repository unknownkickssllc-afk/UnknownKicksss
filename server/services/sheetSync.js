const { createHash } = require('node:crypto');

const SOURCE_SPREADSHEET_ID = '1b8IlcWscjViVLk_5eN0Wef3REYtwNl0zjy1_-j-koro';
const LIMITS = Object.freeze({ sheets:20, rowsPerSheet:2000, cellLength:4000, money:100000000 });
function fail(message) { const error = new Error(message); error.status = 400; error.code = 'INVALID_SHEET_SNAPSHOT'; throw error; }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const blank = value => value === null || value === '' || (typeof value === 'string' && !value.trim());
function text(value, label, max = LIMITS.cellLength) {
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be text within the supported limit.`);
  return value;
}
function number(value, label, {negative = false, integer = false} = {}) {
  if (blank(value)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > LIMITS.money || (!negative && value < 0) || (integer && (!Number.isInteger(value) || value < 1 || value > 100000))) fail(`${label} must contain a valid ${integer ? 'positive whole number' : 'number'}, or be blank.`);
  return value;
}
function date(value, label, mixed = false) {
  if (blank(value)) return null;
  if (typeof value !== 'string') fail(`${label} must be a date in YYYY-MM-DD format, or blank.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (mixed) return null;
    fail(`${label} must be a date in YYYY-MM-DD format, or blank.`);
  }
  const parsed = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== value) fail(`${label} contains an invalid calendar date.`);
  return value;
}
function cells(value, label, width, display = false) {
  if (!Array.isArray(value) || value.length !== width) fail(`${label} must contain exactly ${width} cells.`);
  return value.map(cell => {
    if (display) return text(cell,label);
    if (cell === null || typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell))) return cell;
    if (typeof cell === 'string') return text(cell,label);
    fail(`${label} contains an unsupported cell value.`);
  });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function snapshotHash(snapshot) {
  // The timestamp is deliberately excluded. This identifies data, not a sync attempt.
  const {capturedAt, snapshotHash:ignored, ...data} = snapshot;
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
}
const normalizedHeader = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g,' ') : '';
function validateInventoryHeaders(values) {
  const expected = [[0,['item name']],[4,['cost of goods sold','sale price']],[5,['quantity']],[7,['cost of goods']],[8,['net profit']]];
  if (!values || expected.some(([index,labels])=>!labels.includes(normalizedHeader(values[index])))) {
    fail('Inventory columns changed. Expected A: Item Name, E: Cost of Goods Sold or Sale price, F: Quantity, H: Cost of Goods, and I: Net Profit. Restore the headers before syncing.');
  }
}
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;
function meaningfulItem(values) {
  return !blank(values[0]) || !blank(values[1]) || !blank(values[4]) || !blank(values[5]) || !blank(values[7]);
}
function normalizeSnapshot(payload, {spreadsheetId = SOURCE_SPREADSHEET_ID} = {}) {
  if (!plain(payload) || payload.spreadsheetId !== spreadsheetId) fail('This snapshot is not from the connected spreadsheet.');
  const title = text(payload.title,'Spreadsheet title',300);
  if (!title.trim()) fail('The spreadsheet title is missing.');
  if (typeof payload.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(payload.capturedAt) || !Number.isFinite(Date.parse(payload.capturedAt))) fail('The snapshot capture time is invalid.');
  // Date.parse normalizes impossible dates, so validate the calendar part too.
  date(payload.capturedAt.slice(0,10),'Capture date');
  const timeZone = text(payload.timeZone,'Spreadsheet time zone',100);
  try { new Intl.DateTimeFormat('en-US',{timeZone}).format(new Date(0)); } catch (_) { fail('The spreadsheet time zone is invalid.'); }
  if (!Array.isArray(payload.sheets) || !payload.sheets.length || payload.sheets.length > LIMITS.sheets) fail(`A snapshot must contain 1–${LIMITS.sheets} supported tabs.`);
  const ids = new Set(), titles = new Set(), items = [], expenses = [], periods = [], warnings = [];
  const counts = {unnamed:0,missingProfit:0,missingQuantity:0,missingCost:0,missingDate:0,mixedNotes:0,blankExpense:0};
  for (const sheet of [...payload.sheets].sort((a,b)=>(a?.id ?? 0)-(b?.id ?? 0))) {
    if (!plain(sheet) || !Number.isSafeInteger(sheet.id) || sheet.id < 0 || ids.has(sheet.id)) fail('Each source tab needs a unique numeric ID.');
    ids.add(sheet.id);
    const label = text(sheet.title,'Tab title',200);
    if (!label.trim() || titles.has(label)) fail('Each source tab needs a unique title.');
    titles.add(label);
    const isExpenses = label.trim().toLowerCase() === 'expenses', width = isExpenses ? 5 : 12;
    if (!Array.isArray(sheet.rows) || sheet.rows.length > LIMITS.rowsPerSheet) fail(`A source tab cannot exceed ${LIMITS.rowsPerSheet} rows.`);
    const rows = [], seenRows = new Set();
    for (const row of sheet.rows) {
      if (!plain(row) || !Number.isInteger(row.row) || row.row < 1 || row.row > LIMITS.rowsPerSheet || seenRows.has(row.row)) fail(`Source rows must be unique and within rows 1–${LIMITS.rowsPerSheet}.`);
      seenRows.add(row.row);
      rows.push({row:row.row,values:cells(row.values,'Source values',width),display:cells(row.display,'Source display values',width,true)});
    }
    rows.sort((a,b)=>a.row-b.row);
    if (!isExpenses) validateInventoryHeaders(rows.find(row=>row.row===1)?.values);
    let revenue = 0, recordedProfit = 0, purchaseCost = 0, rowCount = 0, profitIncomplete = false, revenueIncomplete = false, purchaseCostIncomplete = false;
    for (const row of rows) {
      const v = row.values, ref = `${label} row ${row.row}`;
      if (isExpenses) {
        if (row.row < 7) fail('Expense source rows must start at row 7.');
        if (v.every(blank)) continue;
        const amount = number(v[3],`${ref} expense amount`);
        if (amount === null) counts.blankExpense++;
        const expenseDate = date(v[0],`${ref} expense date`);
        expenses.push({sourceSheetId:sheet.id,sourceRow:row.row,period:label,date:expenseDate,category:blank(v[1])?null:String(v[1]),description:blank(v[4])?null:String(v[4]),amount,notes:blank(v[2])?null:String(v[2]),sourceValues:v,sourceDisplay:row.display});
        continue;
      }
      if (row.row === 1 || !meaningfulItem(v)) continue;
      const item = blank(v[0]) ? null : text(v[0],`${ref} item name`), quantity = number(v[5],`${ref} quantity`,{integer:true}), salePrice = number(v[4],`${ref} unit sale price`), unitFee = number(v[6],`${ref} unit fee`), unitCost = number(v[7],`${ref} unit cost`), profit = number(v[8],`${ref} recorded profit`,{negative:true});
      const chargeDate = date(v[10],`${ref} charge date`), saleDate = date(v[11],`${ref} sale date`,true), notes = blank(v[11]) || saleDate ? null : text(v[11],`${ref} sale notes`);
      const daysToSell = number(v[3],`${ref} days to sell`), roi = number(v[9],`${ref} ROI`,{negative:true});
      const sold = salePrice !== null;
      if (!item) counts.unnamed++;
      if (quantity === null) counts.missingQuantity++;
      if (unitCost === null) { counts.missingCost++; purchaseCostIncomplete = true; }
      if (sold && profit === null) { counts.missingProfit++; profitIncomplete = true; }
      if (sold && !saleDate) counts.missingDate++;
      if (notes) counts.mixedNotes++;
      if (sold && quantity === null) revenueIncomplete = true;
      if (unitCost !== null && quantity === null) purchaseCostIncomplete = true;
      if (salePrice !== null && quantity !== null) revenue += salePrice * quantity;
      if (profit !== null) recordedProfit += profit;
      if (unitCost !== null && quantity !== null) purchaseCost += unitCost * quantity;
      items.push({sourceSheetId:sheet.id,sourceRow:row.row,period:label,item,sku:blank(v[1])?null:String(v[1]),category:blank(v[2])?null:String(v[2]),daysToSell,quantity,unitFee,unitCost,salePrice,recordedProfit:profit,roi,chargeDate,saleDate,notes,status:sold?(salePrice===0?'zero value disposition':'sale recorded'):'inventory snapshot',paymentStatus:'receipt unverified',sourceValues:v,sourceDisplay:row.display});
      rowCount++;
    }
    if (!isExpenses) periods.push({sourceSheetId:sheet.id,label,revenue:rounded(revenue),recordedProfit:rounded(recordedProfit),profitIncomplete,revenueIncomplete,purchaseCost:rounded(purchaseCost),purchaseCostIncomplete,rowCount});
  }
  const totals = {revenue:rounded(periods.reduce((sum,period)=>sum+period.revenue,0)),recordedProfit:rounded(periods.reduce((sum,period)=>sum+period.recordedProfit,0)),purchaseCost:rounded(periods.reduce((sum,period)=>sum+period.purchaseCost,0)),expenses:rounded(expenses.reduce((sum,expense)=>sum+(expense.amount??0),0)),rowCount:items.length,expenseCount:expenses.length,profitIncomplete:periods.some(period=>period.profitIncomplete),revenueIncomplete:periods.some(period=>period.revenueIncomplete),purchaseCostIncomplete:periods.some(period=>period.purchaseCostIncomplete),expensesIncomplete:expenses.some(expense=>expense.amount===null)};
  warnings.push('Source figures are a read-only Google Sheet snapshot. Recorded sales and profit are not verified cash or net profit and are separate from website orders and business records.');
  if (counts.unnamed) warnings.push(`${counts.unnamed} unnamed item rows were retained because they contain source data.`);
  if (counts.missingProfit) warnings.push(`${counts.missingProfit} recorded-sale rows have missing profit. Missing profit is excluded from totals; the profit total is incomplete.`);
  if (counts.missingQuantity) warnings.push(`${counts.missingQuantity} item rows have no quantity. Their price-times-quantity totals are incomplete; no quantity was assumed.`);
  if (counts.missingCost) warnings.push(`${counts.missingCost} item rows have no purchase cost. Purchase-cost totals exclude missing values.`);
  if (counts.missingDate) warnings.push(`${counts.missingDate} recorded-sale rows have no exact sale date. They remain under the original tab period.`);
  if (counts.mixedNotes) warnings.push(`${counts.mixedNotes} rows have payment or payout notes in the sale-date column. These notes do not establish that payment was received.`);
  if (counts.blankExpense) warnings.push(`${counts.blankExpense} expense rows have no amount. The expense total excludes those missing values.`);
  const snapshot = {sourceId:payload.spreadsheetId,title,capturedAt:payload.capturedAt,timeZone,periods,items,expenses,totals,warnings};
  snapshot.snapshotHash = snapshotHash(snapshot);
  return snapshot;
}
module.exports = {normalizeSnapshot,snapshotHash,SOURCE_SPREADSHEET_ID,LIMITS};
