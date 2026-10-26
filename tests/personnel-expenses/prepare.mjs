/** Adds only dedicated fictional records to an explicitly acknowledged loopback stack. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, rpc, login, directory } from '../prepaid-hours/server-local.mjs';
const prefix = 'personnel-expense-';
const privateFile = join(directory, 'personnel-expenses-fixture.private.json');
await connect();
try {
 const before = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 if (!existsSync(privateFile)) writeFileSync(privateFile, JSON.stringify({ before }), { mode: 0o600 });
 const payload = structuredClone(before);
 for (const key of ['contacts','houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments']) payload[key] = (payload[key] ?? []).filter(row => !row.id.startsWith(prefix));
 const createdAt = '2026-10-01T00:00:00.000Z';
 const workers = [['clement','Clément fictif'],['other','Autre intervenant fictif'],['empty','Sans frais fictif'],['archived','Archivé fictif']].map(([key,name]) => ({ id:prefix+key,contactName:name,role:'Entretien fictif',hourlyRate:25,status:key==='archived'?'Inactif':'Actif',createdAt }));
 payload.houseTrackingWorkers.push(...workers);
 const houses = ['a','b'].map(key=>({id:prefix+'house-'+key,name:'Maison '+key.toUpperCase()+' des frais fictifs',address:'Adresse fictive',createdAt}));
 payload.houseTrackingHouses.push(...houses);
 const entry = (id,key,date,houseKey,extra={}) => ({id:prefix+id,workerId:prefix+key,workerName:workers.find(w=>w.id===prefix+key).contactName,houseId:prefix+'house-'+houseKey,houseName:houses.find(h=>h.id===prefix+'house-'+houseKey).name,date,startTime:'09:00',endTime:'10:00',breakMinutes:0,hourlyRate:25,note:'Heure historique fictive '+id,createdAt,...extra});
 const entries = Array.from({length:10},(_,i)=>entry('clement-'+i,'clement','2026-10-'+String(i+1).padStart(2,'0'),i%2?'b':'a',i===0?{expenseAmount:10.1,expenseNote:'Transport fictif initial'}:i===7?{expenseAmount:48.6,expenseNote:'Trajet fictif au-delà des sept premières lignes'}:i===9?{expenseAmount:.2,expenseNote:''}:i===4?{expenseAmount:0,expenseNote:'Aucun remboursement demandé'}:{}));
 entries.push(entry('previous-month','other','2026-09-30','a',{expenseAmount:99,expenseNote:'Frais fictif hors période'}),entry('other','other','04/10/2026','a',{expenseAmount:8.4,expenseNote:'Achat fictif autre intervenant'}),entry('empty','empty','2026-10-04','a'),entry('archived','archived','2026-10-05','b',{expenseAmount:2.2,expenseNote:'Frais historiques fictifs archivés'}));
 payload.houseTimeEntries.push(...entries);
 payload.housePayments.push({id:prefix+'payment',workerId:prefix+'clement',workerName:'Clément fictif',houseId:prefix+'house-a',houseName:houses[0].name,date:'2026-10-01',amount:50,method:'Virement',note:'Paiement fictif conservé',createdAt});
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[payload]);
 const fixtures = JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
 for(const u of Object.values(fixtures.users)) u.token=await login(u);
 writeFileSync(join(directory,'fixtures.private.json'),JSON.stringify(fixtures),{mode:0o600});
 const ledger=await rpc('crm_house_prepaid_state',fixtures.users.owner.token,{});assert.equal(ledger.status,200);assert.equal(ledger.data.complete,true);
 const file=JSON.parse(readFileSync(privateFile,'utf8'));file.ledger=ledger.data;file.sources=payload;file.preparedAt=new Date().toISOString();
 writeFileSync(privateFile,JSON.stringify(file),{mode:0o600});
 console.log('14 fictional interventions ready: ten Clément October rows, three positive expenses including rows eight and ten, other/empty/archived and September controls; existing sources and prepaid ledger retained.');
} finally {await sql.end();}
