const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {it} = require('node:test');
const {normalizeSnapshot,snapshotHash,SOURCE_SPREADSHEET_ID} = require('../server/services/sheetSync');
const row = (number,values) => ({row:number,values,display:values.map(value=>value==null?'':String(value))});
const item = (name='Sneaker',changes={}) => Object.assign([name,'SKU','Shoes',5,100,2,5,60,70,0.5,'2026-05-01','2026-05-06'],changes);
const header = () => row(1,['Item Name','SKU','Category','Days to Sell','Cost of Goods Sold','Quantity','Fee','Cost of Goods','Net Profit','ROI','Date charged','Sale Date']);
const fixture = () => ({spreadsheetId:SOURCE_SPREADSHEET_ID,title:'Synthetic reselling sheet',capturedAt:'2026-10-14T02:00:00.000Z',timeZone:'America/New_York',sheets:[{id:1,title:'August & September 2026',rows:[header(),row(2,item()),row(3,item('Unsold',{4:'',5:1,6:0,7:50,8:'',9:-1,11:''})),row(4,item('Pending',{4:80,5:1,6:'',7:40,8:'',11:'waiting on rundown payout'}))]},{id:2,title:'Expenses',rows:[row(7,['2026-05-10','Travel','',10,'Gas']),row(8,['','Packaging','',0,'Free bags'])]}]});

it('normalizes source quantities and recorded formulas without treating pending figures as cash or splitting combined periods',()=>{
  const result=normalizeSnapshot(fixture());
  assert.equal(result.sourceId,SOURCE_SPREADSHEET_ID);
  assert.equal(result.periods.length,1);assert.equal(result.periods[0].label,'August & September 2026');
  assert.equal(result.totals.revenue,280);assert.equal(result.totals.recordedProfit,70);assert.equal(result.totals.purchaseCost,210);assert.equal(result.totals.expenses,10);
  assert.equal(result.totals.profitIncomplete,true);assert.equal(result.items[2].recordedProfit,null);
  assert.equal(result.items[2].notes,'waiting on rundown payout');assert.equal(result.items[2].saleDate,null);
  assert.equal(result.items[2].paymentStatus,'receipt unverified');assert.equal(result.items[1].status,'inventory snapshot');
  assert.equal(result.items[0].sourceValues[8],70);assert.equal(result.expenses[1].amount,0);assert.equal(result.expenses[1].date,null);
  assert.ok(result.warnings.some(value=>value.includes('not verified cash')));
  assert.ok(result.warnings.some(value=>value.includes('missing profit')));
});
it('keeps confirmed zero dispositions and negative source profit, with missing quantities left unknown',()=>{
  const input=fixture();input.sheets[0].rows=[header(),row(2,item('Giveaway',{4:0,5:1,7:40,8:-40,11:'giveaway-pending'})),row(3,item('Missing quantity',{4:80,5:'',7:40,8:20,11:''}))];
  const result=normalizeSnapshot(input);
  assert.equal(result.items[0].status,'zero value disposition');assert.equal(result.items[0].recordedProfit,-40);assert.equal(result.items[1].quantity,null);
  assert.equal(result.totals.revenue,0);assert.equal(result.totals.recordedProfit,-20);assert.equal(result.totals.revenueIncomplete,true);assert.equal(result.totals.purchaseCostIncomplete,true);
});
it('retains unnamed records with actual data and skips empty formula-only rows',()=>{
  const input=fixture();input.sheets[0].rows.push(row(5,item('',{4:'',8:'',9:-1})),row(6,['','','','','','',0,'','',-1,'','']));
  const result=normalizeSnapshot(input);
  assert.equal(result.items.length,4);assert.equal(result.items[3].item,null);assert.ok(result.warnings.some(value=>value.includes('1 unnamed item')));
});
it('hashes unchanged data identically across capture time, object key order, tab delivery order and row delivery order',()=>{
  const input=fixture(), first=normalizeSnapshot(input);input.capturedAt='2026-10-15T02:00:00.000Z';input.sheets.reverse();input.sheets[1].rows.reverse();
  const second=normalizeSnapshot(input);assert.equal(first.snapshotHash,second.snapshotHash);
  const reordered=Object.fromEntries(Object.entries(first).reverse());assert.equal(snapshotHash(reordered),first.snapshotHash);
  input.sheets[1].rows.find(row=>row.row===2).values[4]=101;
  assert.notEqual(normalizeSnapshot(input).snapshotHash,first.snapshotHash);
});
it('rejects wrong sources, overflow, duplicate rows, invalid cells, numeric strings and malformed dates without a partial result',()=>{
  const mutations=[value=>value.spreadsheetId='another-sheet',value=>value.sheets=Array.from({length:21},(_,i)=>({...value.sheets[0],id:i})),value=>value.sheets[0].rows.push(row(2001,item())),value=>value.sheets[0].rows.push(row(2,item())),value=>value.sheets[0].rows[0].values[0]='Changed header',value=>value.sheets[0].rows[1].values[4]='$100',value=>value.sheets[0].rows[1].values[5]=1.5,value=>value.sheets[0].rows[1].values[8]='#REF!',value=>value.sheets[0].rows[1].values[10]='2026-02-30',value=>value.sheets[0].rows[1].values[11]='2026-02-30',value=>value.sheets[0].rows[1].values[10]='05/01/26',value=>value.sheets[0].rows[1].values[4]=Infinity,value=>value.sheets[0].rows[1].display[0]={text:'invalid'},value=>value.sheets[0].rows[1].values.push('Summary M must not be included'),value=>value.timeZone='invalid/time-zone',value=>value.capturedAt='2026-02-30T02:00:00Z',value=>value.sheets[1].rows[0].values[3]='10'];
  for(const mutate of mutations){const input=fixture();mutate(input);assert.throws(()=>normalizeSnapshot(input),error=>error.status===400&&error.code==='INVALID_SHEET_SNAPSHOT');}
});
it('does not invent an expense amount when its source cell is blank',()=>{
  const input=fixture();input.sheets[1].rows[0].values[3]='';const result=normalizeSnapshot(input);
  assert.equal(result.expenses[0].amount,null);assert.equal(result.totals.expensesIncomplete,true);assert.equal(result.totals.expenses,0);
});

function scriptHarness({responseCode=200,locked=true,lastRow=4,tabs=5,meaningfulTailRow=null,missingTab=null,badHeader=null,badFinancialHeader=false,allInventoryLastRow=null,es5Builtins=false}={}) {
  const original=readFileSync(path.join(__dirname,'../server/integrations/google-sheets.gs'),'utf8');
  const script=original.replace('__SHEET_SYNC_ENDPOINT__','https://www.unknownkickss.co/api/integrations/sheets').replace('__PROCESS_ENDPOINT__','https://www.unknownkickss.co/api/integrations/process').replace('__SYNC_TOKEN__','test_only_token_12345678901234567890123456789');
  const data=[header().values,item(),item('',{4:'',8:'',9:-1}),['','','','','','',0,'','',-1,'','']];
  const calls=[],triggers=[],deleted=[],ranges=[];let released=0;
  const definitions=[{id:72108132,title:'May 2026'},{id:1515861308,title:'June 2026'},{id:295653990,title:'July 2026'},{id:1849494495,title:'August & September 2026'},{id:1402387966,title:'Expenses'}];
  while(definitions.length<tabs)definitions.push({id:definitions.length+10,title:'Other '+definitions.length});
  const sheets=definitions.filter(def=>def.title!==missingTab).map((def,sheetIndex)=>({
    getName:()=>def.title,getSheetId:()=>def.id,
    getLastRow:()=>def.title==='Expenses'?6:allInventoryLastRow||(sheetIndex===0?lastRow:1),
    getRange(start,column,height,width){
      ranges.push({sheetId:def.id,start,column,height,width});
      function sourceRows(){return Array.from({length:height},(_,index)=>{const number=start+index;if(number===1){const values=header().values;if(badFinancialHeader&&sheetIndex===0)values[4]='Unit cost';return values;}if(sheetIndex===0&&number===meaningfulTailRow)return item('Actual tail record');if(sheetIndex===0&&number<=data.length)return data[number-1];return ['','','','','','',0,'','',-1,'',''];});}
      return {getValue:()=>badHeader===def.title?'Changed header':sheetIndex<4?'Item Name':'',getValues:sourceRows,getDisplayValues:()=>sourceRows().map(row=>row.map(value=>String(value??'')))};
    }
  }));
  const spreadsheet={getId:()=>SOURCE_SPREADSHEET_ID,getSpreadsheetTimeZone:()=> 'America/New_York',getName:()=> 'Test spreadsheet',getSheets:()=>sheets};
  const context={Date,SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet},Utilities:{formatDate:()=> '2026-05-01'},LockService:{getScriptLock:()=>({tryLock:()=>locked,releaseLock(){released++;}})},UrlFetchApp:{fetch(url,options){calls.push({url,options});return {getResponseCode:()=>responseCode};}},ScriptApp:{getProjectTriggers:()=>[{getHandlerFunction:()=> 'syncUnknownKickss'},{getHandlerFunction:()=> 'unrelated'}],deleteTrigger:trigger=>deleted.push(trigger.getHandlerFunction()),newTrigger(name){const trigger={name};const builder={timeBased(){trigger.kind='time';return builder;},everyMinutes(value){trigger.minutes=value;return builder;},forSpreadsheet(value){assert.equal(value,spreadsheet);return builder;},onEdit(){trigger.kind='edit';return builder;},create(){triggers.push(trigger);return trigger;}};return builder;}}};
  vm.createContext(context);
  if (es5Builtins) vm.runInContext("Array.prototype.find = Array.prototype.findIndex = Array.prototype.includes = Array.prototype.flat = Array.prototype.flatMap = undefined; Array.from = Array.of = undefined; String.prototype.includes = String.prototype.startsWith = String.prototype.endsWith = undefined; Object.assign = Object.entries = Object.values = Object.fromEntries = undefined; Number.isFinite = Number.isInteger = Number.isSafeInteger = undefined; Map = Set = Promise = Symbol = undefined;",context);
  vm.runInContext(script,context);
  return {context,calls,triggers,deleted,ranges,released:()=>released,original};
}
it('Apps Script remains compatible with the existing Rhino project without changing its runtime',()=>{
  const test=scriptHarness({es5Builtins:true});
  // Node's parser accepts newer grammar, so explicitly guard the unsupported
  // syntax responsible for the live Rhino parse failure as well as common
  // newer syntax; the sandbox above removes the newer runtime helpers.
  const code=test.original.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/\b(?:const|let|class|async|await)\b|=>|`|\.\.\.|\?\.|\?\?/);
  test.context.installUnknownKickssSync();
  assert.equal(test.calls.length,2,'Initial snapshot and queued-work request both succeed with ES5 built-ins');
  const payload=JSON.parse(test.calls[0].options.payload);
  assert.equal(payload.sheets.length,5);
  assert.equal(payload.sheets[0].rows.length,3);
  assert.equal(typeof payload.capturedAt,'string');
  assert.deepEqual(test.deleted,['syncUnknownKickss']);
  assert.equal(test.triggers.length,2);
  assert.equal(test.triggers[0].minutes,15);
  assert.equal(test.triggers[1].kind,'edit');
});
it('Apps Script posts a read-only complete snapshot then processes queued work under one lock',()=>{
  const test=scriptHarness();test.context.syncUnknownKickss();
  assert.equal(test.calls.length,2);assert.match(test.calls[1].url,/\/process$/);assert.equal(test.calls[1].options.payload,'{}');
  const payload=JSON.parse(test.calls[0].options.payload);assert.equal(payload.sheets[0].rows.length,3);assert.equal(payload.sheets[0].rows[0].row,1);assert.equal(payload.sheets[0].rows[2].values[0],'');
  assert.equal(test.calls[0].options.followRedirects,false);assert.equal(test.calls[0].options.muteHttpExceptions,true);assert.match(test.calls[0].options.headers.Authorization,/^Bearer /);assert.equal(test.released(),1);
  assert.doesNotMatch(test.original,/\.setValues?\(|\.insertColumn|Logger\.|console\./);
  const skipped=scriptHarness({locked:false});skipped.context.syncUnknownKickss();assert.equal(skipped.calls.length,0);
});
it('Apps Script rejects oversized workbooks and non-success responses without sending a partial snapshot or leaking response text',()=>{
  for(const options of [{lastRow:20001},{tabs:21}]){const test=scriptHarness(options);assert.throws(()=>test.context.syncUnknownKickss(),/safety limit|row 20000/);assert.equal(test.calls.length,0);assert.equal(test.released(),1);}
  const failure=scriptHarness({responseCode:403});assert.throws(()=>failure.context.syncUnknownKickss(),/HTTP 403/);assert.equal(failure.calls.length,1);assert.equal(failure.released(),1);
});
it('Apps Script installs only its own 15-minute and edit triggers after a successful first snapshot',()=>{
  const test=scriptHarness();test.context.installUnknownKickssSync();
  assert.deepEqual(test.deleted,['syncUnknownKickss']);assert.equal(test.triggers.length,2);assert.equal(test.triggers[0].minutes,15);assert.equal(test.triggers[1].kind,'edit');
  const failure=scriptHarness({responseCode:400});assert.throws(()=>failure.context.installUnknownKickssSync());assert.equal(failure.deleted.length,0);assert.equal(failure.triggers.length,0);
});


it('Apps Script scans all 10002 source rows and excludes blank formula tails before posting',()=>{
  const test=scriptHarness({lastRow:10002});test.context.syncUnknownKickss();
  assert.equal(test.calls.length,2);const payload=JSON.parse(test.calls[0].options.payload);
  assert.equal(payload.sheets.length,5);assert.equal(payload.sheets[0].rows.length,3);
  const scans=test.ranges.filter(range=>range.sheetId===72108132&&range.height);
  assert.equal(scans.length,11);assert.equal(scans[0].height,1000);
  assert.equal(scans.at(-1).start,10001);assert.equal(scans.at(-1).height,2);
  assert.equal('timeoutSeconds' in test.calls[0].options,false);
});
it('Apps Script fails the entire snapshot when meaningful data appears in the tail beyond row 2000',()=>{
  for(const meaningfulTailRow of [2001,10002]){
    const test=scriptHarness({lastRow:10002,meaningfulTailRow});
    assert.throws(()=>test.context.syncUnknownKickss(),/meaningful source data exceeds row 2000/);
    assert.equal(test.calls.length,0);assert.equal(test.released(),1);
  }
});
it('Apps Script requires all known source tabs and inventory headers before sending totals',()=>{
  for(const options of [{missingTab:'June 2026'},{missingTab:'Expenses'},{badHeader:'July 2026'}]){
    const test=scriptHarness(options);assert.throws(()=>test.context.syncUnknownKickss(),/required source tab|Item Name header/);assert.equal(test.calls.length,0);assert.equal(test.released(),1);
  }
});
it('Apps Script caps aggregate cell reads before any snapshot POST',()=>{
  const test=scriptHarness({allInventoryLastRow:20000,tabs:6});
  // Each of four inventory tabs reads 240,000 values and its first display chunk.
  assert.throws(()=>test.context.syncUnknownKickss(),/1,000,000-cell read limit/);
  assert.equal(test.calls.length,0);assert.equal(test.released(),1);
});


it('requires mapped financial headers and accepts only explicit sale-price aliases with normalized whitespace and case',()=>{
  for(const column of [0,4,5,7,8]){
    const input=fixture();input.sheets[0].rows[0].values[column]='Different column';
    assert.throws(()=>normalizeSnapshot(input),/Inventory columns changed/);
  }
  const shifted=fixture();[shifted.sheets[0].rows[0].values[4],shifted.sheets[0].rows[0].values[5]]=[shifted.sheets[0].rows[0].values[5],shifted.sheets[0].rows[0].values[4]];
  assert.throws(()=>normalizeSnapshot(shifted),/Inventory columns changed/);
  const input=fixture();input.sheets[0].rows[0].values[0]='  ITEM   NAME  ';input.sheets[0].rows[0].values[4]=' SALE   PRICE ';input.sheets[0].rows[0].values[5]=' quantity ';input.sheets[0].rows[0].values[7]=' COST OF   GOODS ';input.sheets[0].rows[0].values[8]=' net   profit ';
  const result=normalizeSnapshot(input);assert.equal(result.totals.revenue,280);
  assert.equal(result.items[0].chargeDate,'2026-05-01');assert.equal(Object.hasOwn(result.items[0],'purchaseDate'),false,'A charge date must not become an inferred purchase date');
});
it('Apps Script rejects financial-column changes before sending a snapshot',()=>{
  const test=scriptHarness({badFinancialHeader:true});assert.throws(()=>test.context.syncUnknownKickss(),/inventory columns changed/);assert.equal(test.calls.length,0);assert.equal(test.released(),1);
});
