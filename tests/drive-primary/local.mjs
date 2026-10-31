/** Owned loopback services only; repository environment files are never loaded. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
const require=createRequire(import.meta.url); require('../i18n/register-typescript.cjs');
export const {createFonciereData,toPresentationData}=require('../../lib/fonciere/model');
export const {createFonciereRepository}=require('../../lib/fonciere/repository');
export const {createGeneratorRepository}=require('../../lib/izord/repository');
assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
export const statusPath=process.env.ARBITRAGE_STATUS_FILE; assert(statusPath,'Owned stack status file required');
export const status=JSON.parse(readFileSync(statusPath,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:57031'); assert.equal(new URL(status.DB_URL).hostname,'127.0.0.1'); assert.equal(new URL(status.DB_URL).port,'57032');
export const directory=dirname(statusPath),fixtureFile=join(directory,'arbitrage-fixture.private.json');
export const output=process.env.ARBITRAGE_OUTPUT||'/private/tmp/fonciere-arbitrage-evidence';mkdirSync(output,{recursive:true});
export const sql=new Client({connectionString:status.DB_URL});
export const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
export const service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),anonymous=createClient(status.API_URL,status.ANON_KEY,options);
export async function connect(){await sql.connect();assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count),0);}
export async function ok(promise){const result=await promise;assert.equal(result.error,null,result.error?.message);return result.data;}
export async function denied(promise){const result=await promise;assert(result.error,'Expected direct server rejection');return result.error;}
export async function login(user){const client=createClient(status.API_URL,status.ANON_KEY,options),signed=await ok(client.auth.signInWithPassword({email:user.email,password:user.password}));return {...user,client,token:signed.session.access_token};}
export const payload=name=>{const data=createFonciereData();data.name=name;delete data.agentContactId;delete data.agencyContactId;for(const key of ['main','view','inside','operation'])data.presentationData.photos[key]='';return {schema:'FONCIERE_PROPERTY_V1',data,sourceDocuments:[],creationIntentHash:'a'.repeat(64)};};
export const fullModules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','fonciere','izord'];
export const fullGrants=Object.fromEntries(fullModules.map(module=>[module,{level:'contribute',sensitive:{delete:true,export:true,...(module==='contacts'?{bank_read:true,bank_write:true}:{}),...(module==='vendorInvoices'?{payment:true}:{})}}]));
