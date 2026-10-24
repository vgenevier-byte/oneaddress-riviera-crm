/** Administrative SQL integration against an explicitly acknowledged loopback
 * PostgreSQL cluster. Creates and drops its own database; never uses API fixtures.
 * CONTACT_COMPANY_LOCAL_SQL_TEST_DB_URL=... CONTACT_COMPANY_DISPOSABLE_LOCAL_ONLY=yes
 * node --test tests/contacts-company-relations/reconciliation-postgres.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { prepareReconciliation, reconciliationSQL } from '../../scripts/contact-company-reconcile.mjs';

const localUrl=process.env.CONTACT_COMPANY_LOCAL_SQL_TEST_DB_URL;
const enabled=Boolean(localUrl)&&process.env.CONTACT_COMPANY_DISPOSABLE_LOCAL_ONLY==='yes';
const rollbackTemplate=readFileSync(new URL('../../scripts/contact-company-rollback.sql',import.meta.url),'utf8');
const journalMigration=readFileSync(new URL('../../supabase/migrations/20261024081412_contact_company_reconciliation_journal.sql',import.meta.url),'utf8');

test('administrative reconciliation and guarded rollback persist safely in PostgreSQL',{skip:!enabled},async t=>{
  const source=new URL(localUrl);
  assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(source.hostname),'Only a loopback disposable PostgreSQL cluster is allowed');
  const databaseName=`contact_relations_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:source.href});
  await admin.connect();
  let client;
  try {
    await admin.query(`create database "${databaseName}"`);
    source.pathname=`/${databaseName}`;
    client=new pg.Client({connectionString:source.href});
    await client.connect();
    await client.query(`
      create schema app_private;
      create table public.crm_workspace_state(workspace_id text primary key,payload jsonb not null,updated_at timestamptz not null default clock_timestamp(),updated_by uuid);
      create function app_private.test_touch_workspace() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp(); return new; end$$;
      create trigger test_touch_workspace before update on public.crm_workspace_state for each row execute function app_private.test_touch_workspace();
      create function app_private.test_contact_guard() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger zz_crm_contact_company_relations before update on public.crm_workspace_state for each row execute function app_private.test_contact_guard();
      create table app_private.task_records(id text primary key,contact_id text,legacy_original jsonb,deleted_at timestamptz);
      create table app_private.task_identity_links(user_id text primary key,contact_id text);
      create table app_private.task_events(id bigint generated always as identity primary key,changes jsonb);
      create table public.fonciere_project_contacts(project_id text primary key,contact_id text,agency_contact_id text);
      create table public.crm_document_scopes(provider text,resource_id text,collection text,record_id text);
      create table app_private.module_collections(module text,collection text,fields jsonb);
      insert into app_private.module_collections values('contacts','contacts','{"companyId":{},"primaryContactId":{}}');
      create table public.fonciere_projects(id text);
      create table public.izord_projects(id text);
      create table public.izord_project_versions(project_id text,revision integer);
      create table public.crm_document_shares(provider text,resource_id text,user_id text);
      create table app_private.document_drive_trash(operation_id text);
      create table public.crm_contacts(id text);
    `);
    await client.query(journalMigration);
    const initial={contacts:[{id:'company',entityType:'company',companyName:'Agence de test',firstName:'Alice',name:'Dupont',email:'general@example.invalid',notes:'Information conservée',budget:123}],vendorInvoices:[{id:'invoice',contactId:'company',amount:1234.56,paidAmount:100}],documents:[{id:'private',resourceId:'private-resource'}]};
    async function fixture(){
      await client.query(`truncate public.crm_workspace_state,app_private.contact_company_reconciliation_runs,app_private.task_records,app_private.task_identity_links,app_private.task_events,public.fonciere_project_contacts,public.crm_document_scopes`);
      await client.query('insert into public.crm_workspace_state(workspace_id,payload) values ($1,$2)', ['oneaddress-riviera',initial]);
      const snapshot=(await client.query("select workspace_id,payload,updated_at::text updated_at,md5(payload::text) payload_md5 from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];
      const company=snapshot.payload.contacts[0];
      const person={id:'created-person',entityType:'person',firstName:'Alice',name:'Dupont',companyId:'company',email:'',phone:'',kind:'Client',budget:0,source:'Reprise explicite',notes:''};
      const plan={operations:[{type:'create',id:person.id,contact:person,evidence:'Complete personal identity explicitly embedded in legacy company',reason:'Create distinct interlocutor without inferred personal coordinates'},{type:'patch',id:company.id,before:company,patch:{primaryContactId:person.id},evidence:'New person explicitly linked to source company',reason:'Select initial interlocutor'}]};
      const prepared=prepareReconciliation(snapshot,plan);
      return {snapshot,prepared,apply:reconciliationSQL(snapshot,prepared),rollback:rollbackTemplate.replace('REVIEWED_PLAN_ID',prepared.planId)};
    }
    async function row(){return (await client.query('select payload,updated_at::text updated_at from public.crm_workspace_state')).rows[0];}
    async function mustReject(sql,message){
      await assert.rejects(client.query(sql),error=>error.message.includes(message));
      await client.query('rollback');
      assert.equal((await client.query("select tgenabled from pg_trigger where tgname='zz_crm_contact_company_relations'")).rows[0].tgenabled,'O');
    }
    await t.test('journal migration enables RLS and denies client access to original personal snapshots',async()=>{
      const privacy=(await client.query(`select relrowsecurity rls,
        has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') anon,
        has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') authenticated,
        has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE') service_role
        from pg_class where oid='app_private.contact_company_reconciliation_runs'::regclass`)).rows[0];
      assert.deepEqual(privacy,{rls:true,anon:false,authenticated:false,service_role:false});
    });
    await t.test('confirmed legacy classifications persist atomically without replacing IDs, source values or accounting',async()=>{
      await fixture();
      const company={id:'legacy-company',companyName:'Groupe fictif',firstName:'Alix',name:'',email:'general@example.invalid'};
      const person={id:'legacy-person',companyName:'Ancienne dénomination du groupe',firstName:'Camille',name:'Martin',email:'camille@example.invalid'};
      const payload={...initial,contacts:[company,person]};
      await client.query('update public.crm_workspace_state set payload=$1',[payload]);
      const snapshot=(await client.query('select workspace_id,payload,updated_at::text updated_at,md5(payload::text) payload_md5 from public.crm_workspace_state')).rows[0];
      const operations=[{type:'patch',id:company.id,before:snapshot.payload.contacts[0],patch:{entityType:'company',primaryContactId:person.id},explicitClassification:true,evidence:'Same legal business explicitly confirmed by human user',reason:'Reuse historical company identity'},{type:'patch',id:person.id,before:snapshot.payload.contacts[1],patch:{entityType:'person',companyId:company.id},explicitClassification:true,evidence:'Complete personal identity explicitly stored; affiliation confirmed by human user',reason:'Qualify and link distinct person'}];
      const prepared=prepareReconciliation(snapshot,{operations});
      await client.query(reconciliationSQL(snapshot,prepared));
      const saved=(await row()).payload;
      assert.deepEqual(saved.contacts,[{...company,entityType:'company',primaryContactId:person.id},{...person,entityType:'person',companyId:company.id}]);
      assert.deepEqual(saved.vendorInvoices,initial.vendorInvoices);
      await client.query(rollbackTemplate.replace('REVIEWED_PLAN_ID',prepared.planId));
      assert.deepEqual((await row()).payload,payload);
    });
    await t.test('apply twice creates one person and one durable journal; rollback restores exact payload and cannot silently reapply',async()=>{
      const f=await fixture();
      await client.query(f.apply);
      const first=await row();
      assert.equal(first.payload.contacts.length,2);
      assert.deepEqual(first.payload.vendorInvoices,initial.vendorInvoices);
      assert.deepEqual(first.payload.documents,initial.documents);
      const journal=(await client.query('select before_payload,after_contacts,after_revision,operations from app_private.contact_company_reconciliation_runs')).rows[0];
      assert.deepEqual(journal.before_payload,initial);
      assert.deepEqual(journal.after_contacts,first.payload.contacts);
      assert.equal(journal.operations.length,2);
      await client.query(f.apply);
      assert.deepEqual(await row(),first);
      assert.equal((await client.query('select count(*)::integer n from app_private.contact_company_reconciliation_runs')).rows[0].n,1);
      await client.query(f.rollback);
      const restored=await row();
      assert.deepEqual(restored.payload,initial);
      await client.query(f.rollback);
      assert.deepEqual(await row(),restored);
      await mustReject(f.apply,'reconciliation_plan_rolled_back');
      assert.deepEqual((await row()).payload,initial);
    });
    await t.test('concurrent revision or payload changes abort before journal insertion',async()=>{
      const f=await fixture();
      await client.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts,0,notes}','\"Concurrent correction\"'::jsonb)");
      const changed=await row();
      await mustReject(f.apply,'reconciliation_source_changed');
      assert.deepEqual(await row(),changed);
      assert.equal((await client.query('select count(*)::integer n from app_private.contact_company_reconciliation_runs')).rows[0].n,0);
    });
    await t.test('post-apply contact corrections block rollback',async()=>{
      const f=await fixture();await client.query(f.apply);
      await client.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts,1,notes}','\"New personal history\"'::jsonb)");
      const changed=await row();await mustReject(f.rollback,'rollback_contacts_changed');assert.deepEqual(await row(),changed);
    });
    await t.test('post-apply accounting corrections block rollback',async()=>{
      const f=await fixture();await client.query(f.apply);
      await client.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{vendorInvoices,0,paidAmount}','200'::jsonb)");
      const changed=await row();await mustReject(f.rollback,'rollback_other_modules_changed');assert.deepEqual(await row(),changed);
    });
    await t.test('confirmed legacy classifications pass the postcheck and an unplanned type change is detected separately',async()=>{
      await fixture();
      const company={...initial.contacts[0]};delete company.entityType;
      const person={id:'legacy-person',firstName:'Alice',name:'Dupont',companyName:'Autre dénomination confirmée',email:'personal@example.invalid',notes:'Historique personnel'};
      const original={...initial,contacts:[company,person]};
      await client.query('update public.crm_workspace_state set payload=$1',[original]);
      const snapshot=(await client.query('select workspace_id,payload,updated_at::text updated_at from public.crm_workspace_state')).rows[0];
      const operations=[
        {type:'patch',id:company.id,before:snapshot.payload.contacts[0],patch:{entityType:'company',primaryContactId:person.id},explicitClassification:true,evidence:'Human-confirmed company identity',reason:'Qualify existing company without overwriting source fields'},
        {type:'patch',id:person.id,before:snapshot.payload.contacts[1],patch:{entityType:'person',companyId:company.id},explicitClassification:true,evidence:'Explicit full personal identity and human-confirmed affiliation',reason:'Qualify distinct person and link the confirmed company'}
      ];
      const prepared=prepareReconciliation(snapshot,{operations});await client.query(reconciliationSQL(snapshot,prepared));
      const query=readFileSync(new URL('../../scripts/contact-company-postcheck.sql',import.meta.url),'utf8').replaceAll('REVIEWED_PLAN_ID',prepared.planId);
      const confirmed=(await client.query(query)).rows[0].postcheck;
      assert.equal(confirmed.contacts.approved_entity_classifications,2);
      for(const key of ['original_fields_changed','unplanned_entity_classifications','planned_patch_mismatches','invalid_company_links','invalid_primary_links','missing_original_ids']) assert.equal(confirmed.contacts[key],0,key);
      assert.equal(confirmed.workspace.noncontacts_unchanged,true);
      assert.equal(confirmed.workspace.matches_journal_contacts,true);
      await client.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts,1,entityType}','\"company\"')");
      const changed=(await client.query(query)).rows[0].postcheck;
      assert.equal(changed.contacts.unplanned_entity_classifications,1);
      assert.equal(changed.contacts.planned_patch_mismatches,1);
      assert.equal(changed.workspace.matches_journal_contacts,false);
    });
    const references=[
      ['canonical task',"insert into app_private.task_records(id,contact_id) values ('task','created-person')"],
      ['deleted canonical task',"insert into app_private.task_records(id,contact_id,deleted_at) values ('task','created-person',clock_timestamp())"],
      ['legacy task identity',"insert into app_private.task_records(id,legacy_original) values ('task','{\"contactId\":\"created-person\"}')"],
      ['account identity',"insert into app_private.task_identity_links(user_id,contact_id) values ('account','created-person')"],
      ['historical task event',"insert into app_private.task_events(changes) values ('{\"contactId\":\"created-person\"}')"],
      ['Foncière agent',"insert into public.fonciere_project_contacts(project_id,contact_id,agency_contact_id) values ('project','created-person','')"],
      ['Foncière agency',"insert into public.fonciere_project_contacts(project_id,contact_id,agency_contact_id) values ('project','','created-person')"],
      ['contact document scope',"insert into public.crm_document_scopes(provider,resource_id,collection,record_id) values ('storage','private-document','contacts','created-person')"]
    ];
    for(const [label,insert] of references) await t.test(`new ${label} reference blocks rollback without deleting history`,async()=>{
      const f=await fixture();await client.query(f.apply);const before=await row();await client.query(insert);
      await mustReject(f.rollback,'rollback_external_contact_reference');assert.deepEqual(await row(),before);
      assert.equal((await client.query('select rolled_back_at from app_private.contact_company_reconciliation_runs')).rows[0].rolled_back_at,null);
    });
    await t.test('concurrent external reference writer finishes before the rollback check and its reference is preserved',async()=>{
      const f=await fixture();await client.query(f.apply);
      const writer=new pg.Client({connectionString:source.href});await writer.connect();
      try {
        await writer.query('begin');
        await writer.query("insert into app_private.task_identity_links(user_id,contact_id) values ('concurrent-account','created-person')");
        const rejection=assert.rejects(client.query(f.rollback),error=>error.message.includes('rollback_external_contact_reference'));
        let blocked=false;
        for(let attempt=0;attempt<50&&!blocked;attempt++){
          blocked=(await admin.query('select $1::integer=any(pg_blocking_pids($2::integer)) blocked',[writer.processID,client.processID])).rows[0].blocked;
          if(!blocked) await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(blocked,true,'Rollback waits for the in-flight external reference writer');
        await writer.query('commit');await rejection;await client.query('rollback');
        assert.equal((await row()).payload.contacts.some(contact=>contact.id==='created-person'),true);
        assert.equal((await client.query('select contact_id from app_private.task_identity_links')).rows[0].contact_id,'created-person');
      } finally {await writer.query('rollback');await writer.end();}
    });
  } finally {
    if(client) await client.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }
});
