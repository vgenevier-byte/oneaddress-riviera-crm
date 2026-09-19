import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {connect,sql,dir} from './local.mjs';
await connect();
try{
 await sql.query("alter table public.crm_document_scopes add column if not exists folder text not null default 'Documents'");
 await sql.query('alter table public.crm_document_scopes add column if not exists superseded_by text');
 const source=readFileSync('supabase/migrations/20260918084849_unified_module_permissions.sql','utf8');
 const revision=source.match(/create function app_private\.module_revision\([\s\S]*?\$\$;/)[0].replace('create function','create or replace function');await sql.query(revision);
 for(const c of JSON.parse(readFileSync('lib/access/collections.json','utf8')))await sql.query('update app_private.module_collections set fields=$2 where collection=$1',[c.collection,c.fields]);
 if(process.argv.includes('--sync')){await sql.query('begin');await sql.query('select pg_advisory_xact_lock(734991)');for(const definition of source.matchAll(/create (?:or replace )?function (?:public|app_private)\.\w+\([\s\S]*?\$\$;/g))await sql.query(definition[0].replace(/^create function/,'create or replace function'));for(const stmt of source.matchAll(/^(?:revoke all on function|grant execute on function)[\s\S]*?;/gm))await sql.query(stmt[0]);await sql.query('commit');}
 const names=[...source.matchAll(/create (?:or replace )?function ((?:public|app_private)\.\w+)\(/g)].map(m=>m[1]);
 const checks=[];for(const full of names){const [schema,name]=full.split('.');const r=await sql.query('select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[schema,name]);assert.equal(r.rows.length,1,full);const actual=r.rows[0].definition.match(/AS \$(?:function)?\$([\s\S]*?)\$(?:function)?\$/)[1].trim();const block=source.match(new RegExp('create (?:or replace )?function '+full.replace('.','\\.')+'\\([\\s\\S]*?\\$\\$;'))[0];const expected=block.split('$$')[1].trim();assert.equal(actual,expected,full);checks.push(full);}
 writeFileSync(dir+'/installed-sql.json',JSON.stringify({functionsMatchFinalSource:checks.length,catalogMatchesFinalSource:true},null,2));console.log('Définitions SQL installées identiques au livrable : '+checks.length+' fonctions.');
}finally{await sql.end();}
