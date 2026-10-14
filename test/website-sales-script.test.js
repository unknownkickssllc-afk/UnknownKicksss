const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {it} = require('node:test');

const SHEET_ID = '1b8IlcWscjViVLk_5eN0Wef3REYtwNl0zjy1_-j-koro';
const OWNER_KEY = 'UNKNOWN_KICKSS_WEBSITE_SALES_V1';
const HEADERS = ['Website sale ID','Order number','Order date (New York)','Payment status','Order status','Items','Units','Subtotal (USD)','Recorded total (USD)','Sales to count (USD)','Review note'];
const clone = value => JSON.parse(JSON.stringify(value));
const sale = (id=1) => [`website:${id}`,`UNK-${id}`,'2026-10-14 11:40:00','paid','confirmed','Test shoe × 1',1,100,105,105,''];
const report = (rows=[sale()]) => ({version:1,spreadsheetId:SHEET_ID,tabName:'Website Sales',generatedAt:'2026-10-14T16:00:00.000Z',hash:'a'.repeat(64),headers:[...HEADERS],rows,summary:{orderCount:rows.filter(row=>row[9]!=='').length,reviewCount:rows.filter(row=>row[9]==='').length},receipt:'synthetic-signed-receipt'});

function harness(options={}) {
  const original=readFileSync(path.join(__dirname,'../server/integrations/google-website-sales.gs'),'utf8');
  const source=original.replace('__WEBSITE_EXPORT_ENDPOINT__','https://www.unknownkickss.co/api/integrations/website-sales').replace('__WEBSITE_ACK_ENDPOINT__','https://www.unknownkickss.co/api/integrations/website-sales/ack').replace('__SYNC_TOKEN__','synthetic-test-token-1234567890123456789012345');
  const events=[], calls=[], writes=[], format=[], properties={unrelated:'preserved',...(options.properties||{})};
  const triggers=['syncUnknownKickss','onUnknownKickssEdit','anotherOwnerFunction','syncUnknownKickssWebsiteSales'].map((handler,index)=>({id:index, getHandlerFunction:()=>handler}));
  const deleted=[],created=[];
  let currentReport=options.report||report(), released=0, nextId=50;
  function sheet(name,id,initial=[],metadata={}) {
    const values=clone(initial),meta={...metadata};
    let maxRows=options.maxRows||1000, maxColumns=options.maxColumns||26, filter=null;
    const object={
      name,id,values,meta,
      getName:()=>object.name,getSheetId:()=>id,
      getLastRow(){for(let index=values.length-1;index>=0;index--)if(values[index].some(value=>value!==''&&value!=null))return index+1;return 0;},
      getMaxRows:()=>maxRows,getMaxColumns:()=>maxColumns,
      insertRowsAfter(after,count){assert.equal(after,maxRows);maxRows+=count;events.push('grow-rows');return object;},
      insertColumnsAfter(after,count){assert.equal(after,maxColumns);maxColumns+=count;events.push('grow-columns');return object;},
      getDeveloperMetadata:()=>Object.entries(meta).map(([key,value])=>({getKey:()=>key,getValue:()=>value})),
      addDeveloperMetadata(key,value){if(options.metadataFailure)throw new Error('simulated metadata failure');meta[key]=value;events.push('metadata');return object;},
      setColumnWidth(column,width){format.push({id,kind:'column',column,width});return object;},
      setRowHeights(row,count,height){format.push({id,kind:'row',row,count,height});return object;},
      setFrozenRows(value){object.frozenRows=value;return object;},setFrozenColumns(value){object.frozenColumns=value;return object;},
      getFilter:()=>filter,
      getRange(row,column,height=1,width=1){
        const range={
          setValues(input){
            if(options.writeFailure)throw new Error('simulated write failure');
            assert.equal(input.length,height);assert.ok(input.every(value=>value.length===width));
            assert.ok(row+height-1<=maxRows);assert.ok(column+width-1<=maxColumns);
            writes.push({id,row,column,height,width,values:clone(input)});events.push('write');
            input.forEach((cells,index)=>{values[row+index-1]??=[];cells.forEach((value,cell)=>{values[row+index-1][column+cell-1]=value;});});return range;
          },
          createFilter(){assert.equal(filter,null);filter={remove(){filter=null;events.push('remove-filter');}};events.push('filter');return filter;}
        };
        for(const method of ['setFontColor','setFontSize','setWrap','setFontWeight','setBackground','setVerticalAlignment','setNumberFormat'])range[method]=function(value){format.push({id,row,column,height,width,method,value});return range;};
        return range;
      }
    };
    return object;
  }
  const sheets=[sheet('May 2026',72108132,[['Item Name','SKU'],['Historical shoe','abc']]),sheet('Expenses',1402387966,[['Expenses'],['Historical expense']]),sheet('Consignment',443,[['Preserve owner data']])];
  if(options.existingSheet)sheets.push(sheet(options.existingSheet.name||'Website Sales',options.existingSheet.id||20,options.existingSheet.values||[['Owner-entered data']],options.existingSheet.metadata||{}));
  const originalSheets=sheets.filter(value=>value.name!=='Website Sales').map(value=>({id:value.id,values:clone(value.values),meta:{...value.meta}}));
  const spreadsheet={getId:()=>options.spreadsheetId||SHEET_ID,getSheets:()=>sheets,getSheetByName:name=>sheets.find(value=>value.name===name)||null,insertSheet(name){assert.equal(sheets.some(value=>value.name===name),false);events.push('insert-sheet');const created=sheet(name,nextId++);sheets.push(created);return created;}};
  const context={Date,SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet,flush(){events.push('flush');if(options.flushFailure)throw new Error('simulated flush failure');}},Utilities:{formatDate(date,timeZone,pattern){assert.equal(timeZone,'America/New_York');assert.equal(pattern,'yyyy-MM-dd HH:mm:ss');return '2026-10-14 12:30:00';}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key]||null,setProperty(key,value){if(options.propertyFailure)throw new Error('simulated property failure');properties[key]=value;events.push('property');}})},LockService:{getScriptLock:()=>({tryLock(value){assert.equal(value,1000);events.push('lock');return options.locked!==false;},releaseLock(){released++;events.push('release');}})},UrlFetchApp:{fetch(url,request){const ack=url.endsWith('/ack');events.push(ack?'ack':'export');calls.push({url,request});if(options.fetchFailure)throw new Error('sensitive upstream response must never leak');return {getResponseCode:()=>ack?(options.ackStatus||200):(options.exportStatus||200),getContentText:()=>options.responseText===undefined?JSON.stringify(currentReport):options.responseText};}},ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger(trigger){deleted.push(trigger);events.push('delete-trigger');triggers.splice(triggers.indexOf(trigger),1);},newTrigger(handler){const trigger={getHandlerFunction:()=>handler};const builder={timeBased(){return builder;},everyMinutes(value){trigger.minutes=value;return builder;},create(){events.push('create-trigger');if(options.triggerFailure)throw new Error('simulated trigger failure');created.push(trigger);triggers.push(trigger);return trigger;}};return builder;}}};
  vm.createContext(context);
  if(options.es5Builtins)vm.runInContext('Array.prototype.find = Array.prototype.findIndex = Array.prototype.includes = Array.prototype.flat = undefined; Array.from = undefined; String.prototype.includes = String.prototype.startsWith = String.prototype.endsWith = undefined; Object.assign = Object.entries = Object.values = undefined; Number.isFinite = Number.isInteger = undefined; Map = Set = Promise = undefined;',context);
  vm.runInContext(source,context);
  return {context,original,events,calls,writes,format,sheets,properties,triggers,deleted,created,options,originalSheets,setReport(value){currentReport=value;},released:()=>released,website:()=>sheets.find(value=>value.name==='Website Sales')};
}

it('writes a private full website report, then flushes and acknowledges its signed receipt',()=>{
  const test=harness();assert.equal(test.context.syncUnknownKickssWebsiteSales(),true);
  assert.equal(test.writes.length,1);assert.equal(test.writes[0].row,1);assert.equal(test.writes[0].width,11);
  assert.deepEqual(test.website().values[4],HEADERS);assert.deepEqual(test.website().values[5],sale());
  assert.notEqual(test.website().values[0][0],'Item Name','Existing source importer must ignore the report tab');
  assert.equal(test.website().frozenRows,5);assert.equal(test.website().frozenColumns,2);
  assert.match(test.website().values[2][0],/New York.*1 counted sales.*0 need review/);
  assert.equal(test.properties.UK_WEB_MANAGED_SHEET_ID,String(test.website().id));
  assert.equal(test.website().meta[OWNER_KEY],`${SHEET_ID}:${test.website().id}`);
  assert.deepEqual(JSON.parse(test.calls[0].request.payload),{spreadsheetId:SHEET_ID});
  assert.deepEqual(JSON.parse(test.calls[1].request.payload),{spreadsheetId:SHEET_ID,receipt:'synthetic-signed-receipt',sheetId:test.website().id});
  assert.ok(test.events.indexOf('write')<test.events.indexOf('flush'));assert.ok(test.events.indexOf('flush')<test.events.indexOf('ack'));
  for(const call of test.calls){assert.equal(call.request.followRedirects,false);assert.equal(call.request.muteHttpExceptions,true);assert.equal(call.request.contentType,'application/json');assert.match(call.request.headers.Authorization,/^Bearer /);}
  assert.equal(test.released(),1);
  const currency=test.format.find(value=>value.method==='setNumberFormat'&&value.column===8);assert.equal(currency.width,3);assert.match(currency.value,/\$#/);
});

it('preserves every old tab and unrelated trigger when installing its five-minute timer',()=>{
  const test=harness();test.context.installUnknownKickssWebsiteSales();
  for(const original of test.originalSheets){const current=test.sheets.find(value=>value.id===original.id);assert.deepEqual(current.values,original.values);assert.deepEqual(current.meta,original.meta);assert.ok(test.writes.every(write=>write.id!==original.id));assert.ok(test.format.every(write=>write.id!==original.id));}
  assert.deepEqual(test.deleted.map(value=>value.getHandlerFunction()),['syncUnknownKickssWebsiteSales']);
  assert.equal(test.created.length,1);assert.equal(test.created[0].minutes,5);
  assert.deepEqual(test.triggers.map(value=>value.getHandlerFunction()),['syncUnknownKickss','onUnknownKickssEdit','anotherOwnerFunction','syncUnknownKickssWebsiteSales']);
  assert.ok(test.events.indexOf('ack')<test.events.indexOf('create-trigger'));assert.ok(test.events.indexOf('create-trigger')<test.events.indexOf('delete-trigger'));
  assert.equal(test.properties.unrelated,'preserved');
});

it('repeated reports update stable rows once and shrinking or empty reports clear the old tail in the same write',()=>{
  const test=harness({report:report([sale(1),sale(2),sale(3)])});test.context.syncUnknownKickssWebsiteSales();
  const first=clone(test.website().values);test.context.syncUnknownKickssWebsiteSales();
  assert.deepEqual(test.website().values,first);assert.equal(test.sheets.filter(value=>value.name==='Website Sales').length,1);
  test.setReport(report([sale(2)]));test.context.syncUnknownKickssWebsiteSales();
  assert.equal(test.writes.length,3);assert.equal(test.writes[2].height,8);assert.deepEqual(test.website().values[5],sale(2));
  assert.ok(test.website().values[6].every(value=>value===''));assert.ok(test.website().values[7].every(value=>value===''));
  test.setReport(report([]));test.context.syncUnknownKickssWebsiteSales();
  assert.equal(test.writes[3].height,6);assert.ok(test.website().values.slice(5).every(row=>row.every(value=>value==='')));
  assert.equal(test.calls.filter(value=>value.url.endsWith('/ack')).length,4);
});

it('refuses a name collision, copied ownership marker, missing owned tab or renamed owned tab without writes',()=>{
  for(const options of [
    {existingSheet:{}},
    {existingSheet:{id:20,metadata:{[OWNER_KEY]:`${SHEET_ID}:19`}}},
    {properties:{UK_WEB_MANAGED_SHEET_ID:'99'}},
    {existingSheet:{name:'Renamed owner report',id:20},properties:{UK_WEB_MANAGED_SHEET_ID:'20'}}
  ]){const test=harness(options);assert.throws(()=>test.context.syncUnknownKickssWebsiteSales(),/not owned|missing or renamed/);assert.equal(test.writes.length,0);assert.equal(test.calls.length,1);assert.equal(test.released(),1);}
});

it('recovers an interrupted install from exact metadata or a saved sheet binding without creating a second tab',()=>{
  for(const options of [
    {existingSheet:{id:20,values:[],metadata:{[OWNER_KEY]:`${SHEET_ID}:20`}}},
    {existingSheet:{id:20,values:[]},properties:{UK_WEB_MANAGED_SHEET_ID:'20'}}
  ]){const test=harness(options);test.context.syncUnknownKickssWebsiteSales();assert.equal(test.website().id,20);assert.equal(test.properties.UK_WEB_MANAGED_SHEET_ID,'20');assert.equal(test.events.includes('insert-sheet'),false);assert.equal(test.calls.length,2);}
  const interrupted=harness({writeFailure:true});assert.throws(()=>interrupted.context.syncUnknownKickssWebsiteSales());
  const createdId=interrupted.website().id;interrupted.options.writeFailure=false;interrupted.context.syncUnknownKickssWebsiteSales();
  assert.equal(interrupted.website().id,createdId);assert.equal(interrupted.events.filter(value=>value==='insert-sheet').length,1);assert.equal(interrupted.writes.length,1);
  const propertyInterrupted=harness({propertyFailure:true});assert.throws(()=>propertyInterrupted.context.syncUnknownKickssWebsiteSales());propertyInterrupted.options.propertyFailure=false;propertyInterrupted.context.syncUnknownKickssWebsiteSales();assert.equal(propertyInterrupted.events.filter(value=>value==='insert-sheet').length,1);
});

it('validates the complete report before creating a tab or changing cells',()=>{
  const mutations=[
    value=>value.version=2,value=>value.spreadsheetId='wrong',value=>value.tabName='May 2026',value=>value.generatedAt='2026-02-30T00:00:00.000Z',value=>value.hash='wrong',value=>value.receipt='',
    value=>value.headers[7]='Changed financial column',value=>value.headers.pop(),value=>value.rows[0].pop(),value=>value.rows[0][0]='website:0',value=>value.rows[0][0]='other:1',
    value=>{value.rows.push(sale());value.summary.orderCount=2;},value=>value.rows[0][1]=10,value=>value.rows[0][3]=null,value=>value.rows[0][5]={name:'invalid'},value=>value.rows[0][5]='x'.repeat(5001),
    value=>value.rows[0][6]=1.5,value=>value.rows[0][7]='100',value=>value.rows[0][8]=-1,value=>value.rows[0][9]=1e12,value=>value.rows[0][9]=null,
    value=>value.summary.orderCount=0,value=>value.summary.reviewCount=-1,value=>value.summary.reviewCount=0.5,
    value=>{value.rows=Array.from({length:10001},(_,index)=>sale(index+1));value.summary.orderCount=10001;},
    value=>{value.rows=Array.from({length:1001},(_,index)=>{const row=sale(index+1);row[5]='x'.repeat(5000);return row;});value.summary.orderCount=1001;}
  ];
  for(const mutate of mutations){const input=report();mutate(input);const test=harness({report:input});assert.throws(()=>test.context.syncUnknownKickssWebsiteSales(),/failed validation/);assert.equal(test.writes.length,0);assert.equal(test.website(),undefined);assert.equal(test.calls.length,1);assert.equal(test.released(),1);}
  // JSON cannot encode infinities; validate them directly as well.
  for(const invalid of [Infinity,-Infinity,NaN]){const test=harness(), input=report();input.rows[0][8]=invalid;assert.throws(()=>test.context.ukWebValidateReport_(input),/failed validation/);}
});

it('writes malicious order text as literal text and permits blank review amounts without inventing a profit',()=>{
  const prefixes=['=IMPORTXML("https://example.invalid")','+1+1','-1+1','@SUM(A1)',' \t=SUM(A1)','\n+2'];
  for(const text of prefixes){const row=sale();row[1]=text;row[5]=text;row[10]=text;const test=harness({report:report([row])});test.context.syncUnknownKickssWebsiteSales();for(const column of [1,5,10])assert.equal(test.website().values[5][column],`'${text}`);}
  const row=sale();row[6]='';row[7]='';row[8]='';row[9]='';row[10]='Missing payment reference; review in Business OS.';
  const test=harness({report:report([row])});test.context.syncUnknownKickssWebsiteSales();assert.deepEqual(test.website().values[5],row);assert.match(test.website().values[2][0],/0 counted sales.*1 need review/);
});

it('never acknowledges failed writes or flushes and keeps old timers on failed initial delivery',()=>{
  for(const options of [{writeFailure:true},{flushFailure:true},{exportStatus:401},{ackStatus:403},{responseText:'<html>secret response</html>'},{fetchFailure:true}]){
    const test=harness(options);assert.throws(()=>test.context.installUnknownKickssWebsiteSales(),error=>!error.message.includes('secret response')&&!error.message.includes('sensitive upstream'));
    assert.equal(test.created.length,0);assert.equal(test.deleted.length,0);assert.equal(test.released(),1);
    if(!options.ackStatus)assert.equal(test.calls.some(call=>call.url.endsWith('/ack')),false);
  }
  const ackRetry=harness({ackStatus:503});assert.throws(()=>ackRetry.context.syncUnknownKickssWebsiteSales());const before=clone(ackRetry.website().values);ackRetry.options.ackStatus=200;ackRetry.context.syncUnknownKickssWebsiteSales();assert.deepEqual(ackRetry.website().values,before);assert.equal(ackRetry.writes.length,2);
  const triggerFailure=harness({triggerFailure:true});assert.throws(()=>triggerFailure.context.installUnknownKickssWebsiteSales());assert.equal(triggerFailure.deleted.length,0);assert.equal(triggerFailure.triggers.filter(value=>value.getHandlerFunction()==='syncUnknownKickssWebsiteSales').length,1);
});

it('shares the project lock and never installs a timer if another spreadsheet operation is still running',()=>{
  const test=harness({locked:false});assert.equal(test.context.syncUnknownKickssWebsiteSales(),false);assert.throws(()=>test.context.installUnknownKickssWebsiteSales(),/Another spreadsheet sync/);assert.equal(test.calls.length,0);assert.equal(test.writes.length,0);assert.equal(test.created.length,0);assert.equal(test.released(),0);
  const wrong=harness({spreadsheetId:'some-other-spreadsheet'});assert.throws(()=>wrong.context.syncUnknownKickssWebsiteSales(),/connected Unknown Kickss spreadsheet/);assert.equal(wrong.calls.length,0);assert.equal(wrong.writes.length,0);assert.equal(wrong.released(),1);
});

it('expands only the managed report grid and rejects unexpected oversized existing report contents',()=>{
  const test=harness({maxRows:4,maxColumns:5,report:report([sale(1),sale(2)])});test.context.syncUnknownKickssWebsiteSales();assert.ok(test.events.includes('grow-rows'));assert.ok(test.events.includes('grow-columns'));assert.equal(test.website().getMaxRows(),7);assert.equal(test.website().getMaxColumns(),11);
  const values=Array.from({length:10006},()=>['unexpected']);const overflow=harness({existingSheet:{id:20,values},properties:{UK_WEB_MANAGED_SHEET_ID:'20'}});assert.throws(()=>overflow.context.syncUnknownKickssWebsiteSales(),/unexpected extra rows/);assert.equal(overflow.writes.length,0);assert.equal(overflow.calls.length,1);
});

it('keeps the generated installer ES5-compatible without changing the source sync or logging credentials',()=>{
  const test=harness({es5Builtins:true});const code=test.original.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/\b(?:const|let|class|async|await)\b|=>|`|\.\.\.|\?\.|\?\?/);
  assert.doesNotMatch(test.original,/Logger\.|console\.|appendRow\(|clearContents\(|deleteSheet\(/);
  test.context.installUnknownKickssWebsiteSales();assert.equal(test.calls.length,2);assert.equal(test.created.length,1);
});
