import assert from "node:assert/strict";
import test from "node:test";
import { buildHousePrepaidLedger, cumulativeHousePrepaidCents, getHouseTimeMinutes } from "../../lib/housePrepaid";
import type { HousePrepaidPackage, HousePrepaidSetting } from "../../lib/housePrepaid";
import type { HouseTimeEntry } from "../../lib/types";
import { buildMonthlyChargesPeriod, exportDetailedChargesCsv, exportPeriodChargesCsv } from "../../lib/monthlyCharges/calculations";
import type { MonthlyChargesSnapshot } from "../../lib/monthlyCharges/types";
import { getHouseTimeTotalAmount } from "../../lib/houseTracking";
const setting: HousePrepaidSetting = { workerId: "w", billingMode:"prepaid", defaultMinutes:1800, defaultPriceCents:50000 };
const plan = (id="p1", paidDate="2026-10-05"): HousePrepaidPackage => ({ id, workerId:"w",paymentId:`payment-${id}`,capacityMinutes:1800,priceCents:50000,paidDate,createdAt:paidDate });
const lesson = (id:string, date:string, startTime="08:00",endTime="10:00", houseId="h1"): HouseTimeEntry => ({ id,date,startTime,endTime,houseId,houseName:houseId,workerId:"w",workerName:"Fixture",breakMinutes:0,hourlyRate:16.5,createdAt:`${date}T10:00:00Z` });
const lessons = Array.from({length:16},(_,i)=>lesson(`e${i}`,`${i<10?"2026-09":"2026-10"}-${String(i+1).padStart(2,"0")}`,"08:00","10:00",i%2?"h1":"h2"));
function snapshot(packages=[plan()],rows=lessons): MonthlyChargesSnapshot {
  const ledger=buildHousePrepaidLedger([setting],packages,rows);
  return { revision:"r",sourceRevision:"s",config:{personRules:[{source:"hours",personId:"w",included:true}],exceptions:[],attachments:[]},
    sources:{invoices:[],timeEntries:rows.map(e=>({...e,personId:e.workerId,personLabel:e.workerName,billingMode:"prepaid",prepaid:ledger.allocations.find(a=>a.entryId===e.id)})),workers:[],suppliers:[],houses:[]},
    permissions:{canContribute:true,contactsVisible:true,readableSources:["hours","invoice"],exportableSources:["hours","invoice"]} };
}
test("paid30h and real32h yield2h uncovered; renewal retroactively covers those lessons with28h available",()=>{
  const before=buildHousePrepaidLedger([setting],[plan()],lessons);
  assert.deepEqual(before.summaries[0],{workerId:"w",purchasedMinutes:1800,performedMinutes:1920,coveredMinutes:1800,availableMinutes:0,uncoveredMinutes:120,paidCents:50000});
  const after=buildHousePrepaidLedger([setting],[plan(),plan("p2","2026-11-01")],lessons);
  assert.deepEqual(after.summaries[0],{workerId:"w",purchasedMinutes:3600,performedMinutes:1920,coveredMinutes:1920,availableMinutes:1680,uncoveredMinutes:0,paidCents:100000});
  assert.equal(before.allocations.reduce((n,a)=>n+a.amountCents,0),53333);
  assert.equal(after.allocations.reduce((n,a)=>n+a.amountCents,0),53333);
});
test("120 quarter hours consume exactly50000 cents; no per-quarter rounding drift",()=>{
  const rows=Array.from({length:120},(_,i)=>lesson(`q${String(i).padStart(3,"0")}`,"2026-09-01","08:00","08:15"));
  const result=buildHousePrepaidLedger([setting],[plan()],rows);
  assert.equal(result.allocations.reduce((n,a)=>n+a.amountCents,0),50000);
  assert.equal(result.summaries[0].availableMinutes,0);
  assert.ok(result.allocations.some(a=>a.amountCents===416));assert.ok(result.allocations.some(a=>a.amountCents===417));
});
test("lesson spans packages in stable civil order and late insertion/correction recomputes once",()=>{
  const rows=[lesson("b","2026-09-02","08:00","10:00"),lesson("a","2026-09-01","00:00","23:00"),lesson("c","2026-09-01","08:00","14:00")];
  const result=buildHousePrepaidLedger([setting],[plan(),plan("p2")],rows);
  assert.deepEqual(result.allocations.find(a=>a.entryId==="b")?.allocations.map(p=>p.minutes),[60,60]);
  assert.equal(result.summaries[0].performedMinutes,1860);
  const corrected=buildHousePrepaidLedger([setting],[plan(),plan("p2")],rows.map(e=>e.id==="b"?{...e,endTime:"09:00"}:e));
  assert.equal(corrected.summaries[0].availableMinutes,1800);
  assert.deepEqual(buildHousePrepaidLedger([setting],[plan(),plan("p2")],[...rows].reverse()),result);
});
test("canonical identities reject duplicate interventions and payment reuse",()=>{
  assert.throws(()=>buildHousePrepaidLedger([setting],[plan()], [lessons[0],lessons[0]]),/Duplicate intervention/);
  assert.throws(()=>buildHousePrepaidLedger([setting],[plan(),{...plan("p2"),paymentId:plan().paymentId}],lessons),/reserved payment/);
});
test("whole-minute validation preserves historical times, pauses and overnight lessons",()=>{
  assert.equal(getHouseTimeMinutes({startTime:"08:07",endTime:"12:42",breakMinutes:5}),270);
  assert.equal(getHouseTimeMinutes({startTime:"23:45",endTime:"00:15",breakMinutes:0}),30);
  assert.throws(()=>getHouseTimeMinutes({startTime:"08:00",endTime:"09:00",breakMinutes:0.5}));
  assert.throws(()=>getHouseTimeMinutes({startTime:"08:00",endTime:"09:00",breakMinutes:61}));
  assert.equal(cumulativeHousePrepaidCents(1800,1800,50000),50000);
});
test("month/house projections retain exact global valuation; payment month never moves the cost",()=>{
  const before=snapshot(),after=snapshot([plan(),plan("p2","2026-11-01")]);
  const full=buildMonthlyChargesPeriod(before,"2026-09","2026-11");
  assert.deepEqual(full.months.map(m=>m.totalCents),[33333,20000,0]);
  assert.deepEqual(buildMonthlyChargesPeriod(after,"2026-09","2026-11").months,full.months);
  const h1=buildMonthlyChargesPeriod(before,"2026-09","2026-10",{houseId:"h1"});
  const h2=buildMonthlyChargesPeriod(before,"2026-09","2026-10",{houseId:"h2"});
  assert.equal(h1.totalCents+h2.totalCents,53333);
  assert.match(exportPeriodChargesCsv(full),/indicative/);
  assert.match(exportDetailedChargesCsv(full),/Minutes à couvrir/);
});
test("ancillary expense is separate and explicit linked invoice excluded without name/amount guessing",()=>{
  const source=snapshot(),entry=source.sources.timeEntries[0];entry.expenseAmount=12.34;
  source.sources.invoices=[{id:"i",personId:"s",personLabel:"Fixture",title:"Package invoice",amount:500,status:"Payé",invoiceDate:"2026-10-05",prepaidPackageId:"p1"},
  {id:"another",personId:"s",personLabel:"Fixture",title:"Different legitimate invoice",amount:500,status:"Payé",invoiceDate:"2026-10-05"}];
  const result=buildMonthlyChargesPeriod(source,"2026-09","2026-10");
  assert.equal(result.totalCents,53333+1234+50000);
  assert.equal(result.entries.find(e=>e.sourceId==="i")?.status,"excluded");
  assert.equal(result.entries.find(e=>e.sourceId===entry.id)?.expenseAmountCents,1234);
  const valued={...lessons[0],billingMode:"prepaid" as const,prepaid:buildHousePrepaidLedger([setting],[plan()],lessons).allocations[0],expenseAmount:12.34};
  assert.equal(getHouseTimeTotalAmount(valued),45.67);
});
test("missing prepaid server projection is invalid, legacy hourly behavior remains exact",()=>{
  const source=snapshot();delete source.sources.timeEntries[0].prepaid;
  assert.equal(buildMonthlyChargesPeriod(source,"2026-09","2026-10").entries[0].status,"invalid");
  assert.equal(getHouseTimeTotalAmount({...lessons[0],hourlyRate:25}),50);
});
