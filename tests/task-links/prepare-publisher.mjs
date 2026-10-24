import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Client} from 'pg';
const state=JSON.parse(readFileSync('/private/tmp/oar-relations-bench/status.private.json','utf8'));
const url=new URL(state.DB_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55932');
const sql=new Client({connectionString:url.href});await sql.connect();
const name='publisher_task_links';
if(!(await sql.query('select 1 from pg_database where datname=$1',[name])).rowCount)await sql.query('create database '+name);
await sql.end();url.pathname='/'+name;
const db=new Client({connectionString:url.href});await db.connect();
if(!(await db.query("select to_regclass('public.publisher_posts') t")).rows[0].t){
 for(const path of ['local-bootstrap.sql','001-crm-boundary.sql','002-car-context.sql','003-contextual-music.sql'])await db.query(readFileSync('lib/publisher/sql/'+path,'utf8'));
}
const id='24100000-0000-4000-8000-000000000001';
await db.query("insert into publisher_posts(id,post_date,creation_mode,creative_universe,creative_moment,creative_style,theme,caption,format,status,generation_status) values($1,'2026-10-24','guided','landscapes','day','elegant','Riviera fictive','Création fictive sans génération externe','Feed 4:5','draft','ready') on conflict(id) do nothing",[id]);
writeFileSync('/private/tmp/oar-task-links-publisher.private.json',JSON.stringify({database:url.href,id}),{mode:0o600});
console.log(JSON.stringify({ready:true,fictional:true,storedCreation:id,providerCalls:0}));await db.end();
