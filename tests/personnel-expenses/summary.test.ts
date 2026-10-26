import assert from 'node:assert/strict';
import test from 'node:test';
import { getHouseTimeExpenseSummary, getHouseTimeTotalAmount } from '../../lib/houseTracking';
import type { HouseTimeEntry } from '../../lib/types';
const entry=(id:string,expenseAmount?:number):HouseTimeEntry=>({id,houseId:'a',houseName:'Maison fictive',workerId:'clement',workerName:'Clément fictif',date:'2026-10-01',startTime:'09:00',endTime:'10:00',breakMinutes:0,hourlyRate:25,createdAt:'2026-10-01',...(expenseAmount===undefined?{}:{expenseAmount})});
test('summary uses exact cents without changing entries or including invalid/zero values',()=>{
 const rows=[entry('a',.1),entry('b',.2),entry('c'),entry('d',0),entry('e',-1),entry('f',NaN),entry('g',1.234)];const before=structuredClone(rows);
 const summary=getHouseTimeExpenseSummary(rows);assert.equal(summary.total,.3);assert.deepEqual(summary.entries,rows.slice(0,2));assert.deepEqual(rows,before);assert.equal(getHouseTimeTotalAmount(rows[0]),25.1);
});
test('summary covers all selected entries beyond seven and adapts to date/house/worker perimeter',()=>{
 const rows=Array.from({length:12},(_,i)=>({...entry('row-'+i,i===9?48.6:i===1?10.1:undefined),houseId:i%2?'b':'a',workerId:i===1?'other':'clement',date:i===9?'2026-10-10':'2026-10-01'}));
 assert.equal(getHouseTimeExpenseSummary(rows).total,58.7);assert.equal(getHouseTimeExpenseSummary(rows.slice(0,7)).total,10.1);
 assert.equal(getHouseTimeExpenseSummary(rows.filter(e=>e.workerId==='clement')).total,48.6);assert.equal(getHouseTimeExpenseSummary(rows.filter(e=>e.houseId==='a')).total,0);assert.equal(getHouseTimeExpenseSummary(rows.filter(e=>e.date>='2026-10-10')).total,48.6);
});
test('empty scope returns no expense rows and zero',()=>{assert.deepEqual(getHouseTimeExpenseSummary([]),{entries:[],total:0});assert.deepEqual(getHouseTimeExpenseSummary([entry('a'),entry('b',0)]),{entries:[],total:0});});
