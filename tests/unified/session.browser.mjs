import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {connect,sql,user,dir} from './local.mjs';
const require=createRequire(import.meta.url),{chromium}=require('/tmp/izord-playwright-runtime-20260917/node_modules/playwright');
await connect();const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
const p=await context.newPage();
async function sdk(action,credentials){return p.evaluate(async({action,credentials})=>{let client;window.webpackChunk_N_E.push([[Math.random()],{},require=>{const modules=require.c?Object.values(require.c):Object.entries(require.m).filter(([,factory])=>String(factory).includes('http://127.0.0.1:55431')).map(([id])=>({exports:require(id)}));for(const entry of modules){for(const value of Object.values(entry.exports||{})){if(value&&typeof value==='object'&&value.auth&&typeof value.auth.refreshSession==='function'&&typeof value.from==='function'){client=value;break;}}if(client)break;}}]);if(!client)throw Error('SDK missing');const r=action==='refresh'?await client.auth.refreshSession():await client.auth.signInWithPassword(credentials);if(r.error)throw Error(r.error.message);return Boolean(r.data.session);},{action,credentials});}
try{
 const admin=await user('admin');await p.goto('http://127.0.0.1:3160/izord');await p.getByLabel('Email',{exact:true}).fill(admin.email);await p.getByLabel('Mot de passe',{exact:true}).fill(admin.password);await p.getByRole('button',{name:'Se connecter',exact:true}).click();await p.getByRole('button',{name:'Nouveau projet',exact:true}).click();await p.locator('#izord-project').fill('Brouillon unifié à conserver');await p.locator('#izord-acq').fill('654321');
 let mutations=0;p.on('request',r=>{if(r.method()==='POST'&&/rpc\/(izord_save|izord_create|crm_mutate)/.test(r.url()))mutations++;});
 const before=mutations;assert.equal(await sdk('refresh'),true);await p.waitForTimeout(500);assert.equal(await p.locator('#izord-acq').inputValue(),'654321');assert.equal(mutations,before);results.push({name:'Real Auth token refresh preserves generator draft and makes no save',status:'passed'});
 p.once('dialog',d=>d.dismiss());await p.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Contacts',exact:true}).click();assert.equal(await p.locator('#izord-acq').inputValue(),'654321');results.push({name:'Unified navigation cancellation retains generator unsaved input',status:'passed'});
 const none=await user('none');assert.equal(await sdk('login',{email:none.email,password:none.password}),true);await p.getByRole('heading',{name:'Aucun accès autorisé'}).waitFor({timeout:15000});assert.equal(await p.locator('#izord-acq').count(),0);assert.ok(!(await p.locator('body').innerText()).includes('Brouillon unifié à conserver'));results.push({name:'Real account switch invalidates and removes previous generator data',status:'passed'});
 writeFileSync(dir+'/session-browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await sql.end();}
