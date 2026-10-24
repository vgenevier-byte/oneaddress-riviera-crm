import test from "node:test";
import assert from "node:assert/strict";
import { loadTaskHouses } from "../../lib/tasks/houseOptions";
import { searchTaskTargets } from "../../lib/tasks/targets";
import { createSearchIndex, searchIndex } from "../../lib/search";
import type { TaskTarget } from "../../lib/tasks/types";

const house = (id: string, label: string, detail = "", searchFields: string[] = []): TaskTarget => ({ ref: { type: "house", id }, label, detail, searchFields, state: "available" });

test("house choices exhaust all authorized pages before common suggestions rank late exact/typo/address results", async () => {
  const houses = Array.from({ length: 452 }, (_, index) => house(`house-${index}`, `Maison fictive ${String(index).padStart(3,"0")}`));
  houses[5] = house("house-typo", "Villa Olivierrs", "Antibes · Rue fictive", ["Antibes", "Rue fictive"]);
  houses[451] = house("house-exact", "Villa des Oliviers", "12 avenue des Érables · Cannes", ["12 avenue des Érables", "Cannes"]);
  const reads: number[] = [];
  const options = await loadTaskHouses(async (query, type, offset = 0, limit = 40) => {
    assert.equal(query, ""); assert.equal(type, "house"); assert.equal(limit, Number.MAX_SAFE_INTEGER); reads.push(offset);
    const cap = Math.min(200, limit);
    return { items: houses.slice(offset, offset + cap), hasMore: offset + cap < houses.length };
  });
  assert.deepEqual(reads, [0, 200, 400]); assert.equal(options.length, 452);
  const index = createSearchIndex(options, row => [row.label,row.detail,...(row.searchFields ?? [])], { getId: row => row.ref.id, getLabel: row => row.label });
  assert.equal(searchIndex(index,"OLIVIERS",{limit:12})[0].item.ref.id,"house-exact");
  assert.equal(searchIndex(index,"cannes erables",{limit:12})[0].item.ref.id,"house-exact");
  assert.equal(searchIndex(index,"cannes olivires",{limit:12})[0].item.ref.id,"house-exact");
  assert.equal(searchIndex(index,"cannes olivires",{limit:12})[0].approximate,true);
  assert.equal(searchIndex(index,"oliviers",{limit:12})[0].approximate,false);
  assert.equal(searchIndex(index,"fictive",{limit:12}).length,12,"display cap applies after all houses were indexed");
});

test("house choices exclude inaccessible/deleted/non-house references and deduplicate by real house id", async () => {
  const visible = house("same", "Maison actuelle");
  const result = await loadTaskHouses(async () => ({ items: [visible,visible,{ ...house("hidden","Titre privé"),state:"inaccessible" },{ ...house("deleted","Maison supprimée"),state:"deleted" },{ ...house("wrong","Autre type"),ref:{type:"contact",id:"wrong"} }], hasMore:false }));
  assert.deepEqual(result,[visible]);
});

test("house catalogue failures never return a partial first page as a complete selection catalogue", async () => {
  await assert.rejects(loadTaskHouses(async (_query,_type,offset) => {
    if (!offset) return { items:[house("first","Première maison")],hasMore:true };
    throw new Error("Droits révoqués");
  }),/Droits révoqués/);
  await assert.rejects(loadTaskHouses(async () => ({ items:[],hasMore:true })),/incomplet/);
});


test("a cancelled house context stops requesting later pages and cannot publish stale options", async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(loadTaskHouses(async () => { calls++; controller.abort(); return { items:[house("stale","Maison ancien compte")],hasMore:true }; },controller.signal), {name:"AbortError"});
  assert.equal(calls,1);
});


test("production display API exhausts native SQL pages once instead of repeating the full catalogue", async () => {
  const houses=Array.from({length:452},(_,index)=>house(`real-${index}`,`Maison ${String(index).padStart(3,"0")}`));
  let apiReads=0;const sqlReads:number[]=[];
  const options=await loadTaskHouses(async (query,type,offset=0,limit=40)=>{
    apiReads++;assert.equal(type,"house");
    return searchTaskTargets(async (sqlOffset,sqlLimit)=>{sqlReads.push(sqlOffset);return {items:houses.slice(sqlOffset,sqlOffset+sqlLimit),hasMore:sqlOffset+sqlLimit<houses.length};},query,offset,limit);
  });
  assert.equal(options.length,452);assert.equal(apiReads,1);assert.deepEqual(sqlReads,[0,200,400]);
});
