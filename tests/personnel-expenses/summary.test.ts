import assert from 'node:assert/strict';
import test from 'node:test';
import { getHouseTimeExpenseSummary, getHouseTimeFinancialSummary, getHouseTimeSettlementSummary, getHouseTimeAmount, getHouseTimeTotalAmount } from '../../lib/houseTracking';
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


test('hours summary uses historic entry rates and rounds only their aggregate, then adds exact expense cents', () => {
 const rows = [
  {...entry('fraction-a', .1), endTime:'09:15', hourlyRate:.02},
  {...entry('fraction-b', .2), endTime:'09:15', hourlyRate:.02},
  {...entry('historic-rate'), endTime:'09:30', hourlyRate:17.33}
 ];
 const before=structuredClone(rows), raw=rows.reduce((sum,row)=>sum+getHouseTimeAmount(row),0);
 const historical=Number(new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(raw));
 const summary=getHouseTimeFinancialSummary(rows);
 assert.equal(summary.hoursAmount,historical);assert.equal(summary.hoursAmount,8.67);
 assert.equal(summary.expenseAmount,.3);assert.equal(summary.totalAmount,8.97);
 assert.notEqual(summary.hoursAmount,rows.reduce((sum,row)=>sum+Math.round(getHouseTimeAmount(row)*100),0)/100);
 assert.deepEqual(rows,before);
 const boundary=getHouseTimeFinancialSummary([{...entry('half-cent'),hourlyRate:1.005}]);
 assert.equal(boundary.hoursAmount,1.01);assert.equal(boundary.totalAmount,1.01);
});

test('financial summary includes every filtered intervention beyond seven and excludes outside selected worker date and house', () => {
 const rows=Array.from({length:12},(_,i)=>({...entry('selected-'+i,i===9?48.6:undefined),houseId:i%2?'b':'a',workerId:i===1?'other':'clement',date:i===9?'2026-10-10':'2026-10-01',hourlyRate:i===9?30:25}));
 assert.deepEqual(getHouseTimeFinancialSummary(rows),{hoursAmount:305,expenseAmount:48.6,totalAmount:353.6});
 assert.deepEqual(getHouseTimeFinancialSummary(rows.slice(0,7)),{hoursAmount:175,expenseAmount:0,totalAmount:175});
 const selected=rows.filter(e=>e.workerId==='clement'&&e.houseId==='b'&&e.date>='2026-10-10'&&e.date<='2026-10-10');
 assert.deepEqual(getHouseTimeFinancialSummary(selected),{hoursAmount:30,expenseAmount:48.6,totalAmount:78.6});
 assert.deepEqual(getHouseTimeFinancialSummary([]),{hoursAmount:0,expenseAmount:0,totalAmount:0});
});

test('expense edits and a partial payment preserve hours value and pre-payment total semantics', () => {
 const original={...entry('editable',48.6),endTime:'13:00'};
 assert.deepEqual(getHouseTimeFinancialSummary([original]),{hoursAmount:100,expenseAmount:48.6,totalAmount:148.6});
 const modified={...original,expenseAmount:60.25};
 const result=getHouseTimeFinancialSummary([modified]);
 assert.equal(result.hoursAmount,100);assert.equal(result.totalAmount,160.25);
 const payment=50;
 assert.equal(Number((result.totalAmount!-payment).toFixed(2)),110.25);
 assert.deepEqual(getHouseTimeFinancialSummary([modified]),result);
});

test('prepaid and mixed consumption use supplied canonical allocation and count expenses once', () => {
 const prepaid={...entry('prepaid',10),billingMode:'prepaid' as const,hourlyRate:16.5,prepaid:{minutes:60,coveredMinutes:60,uncoveredMinutes:0,coveredCents:999,uncoveredCents:0,amountCents:999}};
 const hourly=entry('hourly',.2),rows=[prepaid,hourly];
 const resolve=(row:HouseTimeEntry)=>row.id==='prepaid'?16.67:getHouseTimeAmount(row);
 assert.deepEqual(getHouseTimeFinancialSummary(rows,resolve),{hoursAmount:41.67,expenseAmount:10.2,totalAmount:51.87});
 assert.deepEqual(getHouseTimeFinancialSummary([prepaid]),{hoursAmount:9.99,expenseAmount:10,totalAmount:19.99});
 assert.equal(getHouseTimeFinancialSummary(rows,row=>row.id==='prepaid'?0:getHouseTimeAmount(row)).totalAmount,35.2);
});

test('unavailable prepaid valuation propagates unknown through mixed totals while keeping known expense amount', () => {
 const unknown={...entry('unavailable',12.34),billingMode:'prepaid' as const,hourlyRate:16.5};
 assert.deepEqual(getHouseTimeFinancialSummary([unknown]),{hoursAmount:null,expenseAmount:12.34,totalAmount:null});
 assert.deepEqual(getHouseTimeFinancialSummary([unknown,entry('hourly',.2)],row=>row.id==='unavailable'?null:getHouseTimeAmount(row)),{hoursAmount:null,expenseAmount:12.54,totalAmount:null});
 assert.deepEqual(getHouseTimeFinancialSummary([entry('hourly-only')]),{hoursAmount:25,expenseAmount:0,totalAmount:25});
});


test('half-cent historical hours and expenses remain coherent with partial and full payment presentation', () => {
 const row={...entry('half-cent-debt',.02),endTime:'09:30',hourlyRate:10.01};
 const result=getHouseTimeFinancialSummary([row]),rawDue=getHouseTimeTotalAmount(row);
 assert.deepEqual(result,{hoursAmount:5.01,expenseAmount:.02,totalAmount:5.03});
 assert.deepEqual(getHouseTimeSettlementSummary(result.totalAmount!,rawDue,2.01),{paidAmount:2.01,balanceAmount:3.02});
 assert.deepEqual(getHouseTimeSettlementSummary(result.totalAmount!,rawDue,1),{paidAmount:1,balanceAmount:4.03});
 assert.deepEqual(getHouseTimeSettlementSummary(result.totalAmount!,rawDue,rawDue),{paidAmount:5.03,balanceAmount:0});
 const edited={...row,expenseAmount:.03},next=getHouseTimeFinancialSummary([edited]);
 assert.equal(next.hoursAmount,result.hoursAmount);assert.equal(next.totalAmount,5.04);
 assert.deepEqual(getHouseTimeSettlementSummary(next.totalAmount!,getHouseTimeTotalAmount(edited),1),{paidAmount:1,balanceAmount:4.04});
});
