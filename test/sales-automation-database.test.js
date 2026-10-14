const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261014012406_sales_automation.sql'),'utf8');
const sale={channel:'instagram',item:'Synthetic shoes',quantity:2,sale_total:180,cost_total:100,fees_total:5,sold_on:'2026-01-05',payment_reference:'fixture-payment',notes:'Confirmed fixture'};
const version='2026-01-05T14:00:00.000Z';

test('automation schema denies clients and confirms once with atomic replay/conflict rules',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO service_role;');
    await db.exec(migration);await db.exec(migration);
    const permissions=(await db.query("SELECT relname,relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT') AS anon_read,has_table_privilege('authenticated',oid,'INSERT') AS client_write FROM pg_class WHERE relname IN ('os_automation_connections','os_sheet_snapshots','os_sale_inbox','os_offsite_sales')")).rows;
    assert.equal(permissions.length,4);for(const row of permissions){assert.equal(row.rls,true);assert.equal(row.anon_read,false);assert.equal(row.client_write,false);}
    const security=(await db.query("SELECT prosecdef AS definer,has_function_privilege('anon',oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',oid,'EXECUTE') AS client_execute FROM pg_proc WHERE proname='os_confirm_offsite_sale'")).rows[0];
    assert.deepEqual(security,{definer:false,anon_execute:false,client_execute:false});
    await db.exec('SET ROLE service_role;');
    const insert=async (external,conversation=null)=> (await db.query("INSERT INTO os_sale_inbox(source,account_id,external_id,status,updated_at,conversation_id) VALUES ('instagram','fixture-account',$1,'review',$2,$3) RETURNING id",[external,version,conversation])).rows[0].id;
    const id=await insert('message-1');
    await assert.rejects(insert('message-1'),/duplicate key/);
    const confirm=async (inboxId,details=sale,expected=version)=>(await db.query('SELECT public.os_confirm_offsite_sale($1::uuid,$2::timestamptz,$3::jsonb) AS result',[inboxId,expected,JSON.stringify(details)])).rows[0].result;
    await assert.rejects(confirm(id,sale,'2026-01-05T13:00:00Z'),/changed/);
    const first=await confirm(id);assert.equal(first.alreadyPosted,false);assert.equal(first.sale.sale_total,180);
    const retry=await confirm(id);assert.equal(retry.alreadyPosted,true);assert.equal(retry.sale.id,first.sale.id);
    await assert.rejects(confirm(id,{...sale,sale_total:181}),/different details/);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM os_offsite_sales')).rows[0].count,1);
    assert.equal((await db.query('SELECT status FROM os_sale_inbox WHERE id=$1',[id])).rows[0].status,'posted');
    const dismiss=await db.query("UPDATE os_sale_inbox SET status='ignored' WHERE id=$1 AND status IN ('review','pending') RETURNING id",[id]);assert.equal(dismiss.rows.length,0);
    const duplicate=await insert('message-2');
    await assert.rejects(confirm(duplicate),/duplicate key/);
    assert.equal((await db.query('SELECT status FROM os_sale_inbox WHERE id=$1',[duplicate])).rows[0].status,'review','failed insert must roll back inbox changes');
    const ignored=await insert('message-3');await db.query("UPDATE os_sale_inbox SET status='ignored' WHERE id=$1",[ignored]);
    await assert.rejects(confirm(ignored,{...sale,payment_reference:null}),/changed/);
    const pending=await insert('message-4');await db.query("UPDATE os_sale_inbox SET status='pending' WHERE id=$1",[pending]);
    const manualFallback=await confirm(pending,{...sale,payment_reference:null});
    assert.equal(manualFallback.alreadyPosted,false,'an owner can complete and confirm a pending draft when AI is unavailable');
    assert.equal((await db.query('SELECT status FROM os_sale_inbox WHERE id=$1',[pending])).rows[0].status,'posted');
    const unknown=await insert('message-5');const incomplete=await confirm(unknown,{...sale,payment_reference:null,cost_total:null,fees_total:null});
    assert.equal(incomplete.sale.cost_total,null);assert.equal(incomplete.sale.fees_total,null);
    const conversationFirst=await insert('conversation-message-1','peer-one');
    const conversationSecond=await insert('conversation-message-2','peer-one');
    await confirm(conversationFirst,{...sale,payment_reference:null});
    await assert.rejects(confirm(conversationSecond,{...sale,item:' SYNTHETIC   shoes ',payment_reference:null}),/matching conversation sale/);
    assert.equal((await db.query('SELECT status FROM os_sale_inbox WHERE id=$1',[conversationSecond])).rows[0].status,'review','similar messages remain visible for owner review');
    const separate=await confirm(conversationSecond,{...sale,payment_reference:'unique-second-payment'});
    assert.equal(separate.alreadyPosted,false,'an explicitly separate payment can represent a legitimate identical sale');
    const otherPeer=await insert('conversation-message-3','peer-two');
    assert.equal((await confirm(otherPeer,{...sale,payment_reference:null})).alreadyPosted,false,'different buyers are not merged');
    const raceA=await insert('race-message-1','race-peer'),raceB=await insert('race-message-2','race-peer');
    const raced=await Promise.allSettled([confirm(raceA,{...sale,payment_reference:null}),confirm(raceB,{...sale,payment_reference:null})]);
    assert.equal(raced.filter(value=>value.status==='fulfilled').length,1);
    assert.match(raced.find(value=>value.status==='rejected').reason.message,/matching conversation sale/);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(db.query('SELECT * FROM os_sale_inbox'),/permission denied/);
    await assert.rejects(confirm(id),/permission denied/);
  }finally{await db.close();}
});
