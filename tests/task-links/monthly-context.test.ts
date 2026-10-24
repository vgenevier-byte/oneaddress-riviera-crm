import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyCharges,exportAnnualChargesCsv} from '../../lib/monthlyCharges/calculations';
import type {MonthlyChargesSnapshot} from '../../lib/monthlyCharges/types';
test('context person filter selects existing sources and names exported scope without mutating amounts',()=>{
 const snapshot:MonthlyChargesSnapshot={revision:'fixture',sourceRevision:'fixture',config:{personRules:[{source:'hours',personId:'worker-A',included:true},{source:'hours',personId:'worker-B',included:true}],exceptions:[],attachments:[]},sources:{invoices:[],suppliers:[],houses:[],workers:[{id:'worker-A',label:'A fictif'},{id:'worker-B',label:'B fictif'}],timeEntries:[{id:'time-A',personId:'worker-A',personLabel:'A fictif',date:'2026-10-01',startTime:'09:00',endTime:'10:00',breakMinutes:0,hourlyRate:20,expenseAmount:5},{id:'time-B',personId:'worker-B',personLabel:'B fictif',date:'2026-10-01',startTime:'09:00',endTime:'11:00',breakMinutes:0,hourlyRate:20,expenseAmount:0}]},permissions:{canContribute:true,readableSources:['hours'],exportableSources:['hours'],contactsVisible:true}};
 const before=JSON.stringify(snapshot);const result=buildMonthlyCharges(snapshot,2026,{source:'hours',personId:'worker-A'});
 assert.equal(result.totalCents,2500);assert.equal(result.entries.length,1);assert.match(exportAnnualChargesCsv(result,{personLabel:'A fictif'}),/Personne : A fictif/);assert.equal(JSON.stringify(snapshot),before);
});
