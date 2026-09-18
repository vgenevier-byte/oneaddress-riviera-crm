import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertNewFixturePath, assertRetainedHashes, assertRestorablePayload, visibleIds, withFixtureVendor } from './reuse-local.mjs';

test('global expected visibility includes every retained and new authorized identity',()=>{
  assert.deepEqual(visibleIds(['old-z','old-a'],['new-b','new-a'],true),['new-a','new-b','old-a','old-z']);
});
test('non-global visibility cannot inherit the retained global inventory',()=>{
  assert.deepEqual(visibleIds(['old-secret'],['own-new'],false),['own-new']);
});
test('new vendor fixture preserves all preceding payload fields and contact objects',()=>{
  const old={contacts:[{id:'fictional-contact-browser',name:'OAR LOCAL CONFIDENTIEL',custom:{keep:true}}],quotes:[{id:'old-quote'}],unknown:{retain:1}};
  const copy=structuredClone(old),result=withFixtureVendor(old,'vendor-new');
  assert.deepEqual(old,copy);assert.deepEqual(result.quotes,old.quotes);assert.deepEqual(result.unknown,old.unknown);
  assert.deepEqual(result.contacts.slice(0,-1),old.contacts);assert.equal(result.contacts.at(-1).id,'vendor-new');
});
test('unexpected shared workspace refuses fictitious preparation',()=>{
  assert.throws(()=>withFixtureVendor({contacts:[{id:'other',name:'unknown'}]},'vendor-new'));
});
test('duplicate vendor identity is refused instead of replacing an old contact',()=>{
  assert.throws(()=>withFixtureVendor({contacts:[{id:'fictional-contact-browser',name:'OAR LOCAL CONFIDENTIEL'},{id:'vendor-old'}]},'vendor-old'));
});
test('retained row hashes allow appended fixtures',()=>{
  assert.doesNotThrow(()=>assertRetainedHashes(['a','b'],['a','b','c']));
});
test('retained row deletion or modification fails closed',()=>{
  assert.throws(()=>assertRetainedHashes(['a','b'],['a']));assert.throws(()=>assertRetainedHashes(['a','b'],['a','changed']));
});
test('retained row multiplicity cannot silently shrink',()=>{
  assert.throws(()=>assertRetainedHashes(['same','same'],['same','new']));
});
test('restoration requires the exact benchmark payload fingerprint',()=>{
  assert.doesNotThrow(()=>assertRestorablePayload('expected','expected'));assert.throws(()=>assertRestorablePayload('expected','newer-edit'));
});
test('new fixtures must use an unused filename in the same private stack',()=>{
  const dir=mkdtempSync(join(tmpdir(),'izord-reuse-unit-'));
  try { assert.doesNotThrow(()=>assertNewFixturePath(join(dir,'new.json'),dir));
    assert.throws(()=>assertNewFixturePath(join(dir,'browser-fixtures.json'),dir));
    assert.throws(()=>assertNewFixturePath(join(tmpdir(),'outside.json'),dir));
    writeFileSync(join(dir,'used.json'),'{}');assert.throws(()=>assertNewFixturePath(join(dir,'used.json'),dir));
  } finally { rmSync(dir,{recursive:true}); }
});
