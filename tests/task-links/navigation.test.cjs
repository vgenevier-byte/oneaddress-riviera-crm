require('../i18n/register-typescript.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readTaskTarget,taskTargetHref,taskTargetModule}=require('../../lib/tasks/navigation.ts');

test('typed routes preserve exact real identities and business context',()=>{
  const refs=[{type:'bank_account',id:'account-1',context:{contactId:'owner-1'}},{type:'worker_period',id:'worker-1',context:{startDate:'2026-11-01',endDate:'2026-11-30',houseId:'house-1'}},{type:'presentation',id:'presentation-1',context:{revision:'7'}},{type:'monthly_charges',id:'2026-11',context:{source:'hours',personId:'worker-1',houseId:'house-1'}},{type:'publisher_creation',id:'creation-1'}];
  for(const ref of refs)assert.deepEqual(readTaskTarget(taskTargetHref(ref)),ref);
  assert.equal(taskTargetModule(refs[0]),'contacts');assert.equal(taskTargetModule(refs[1]),'houseTracking');
});
test('separate document catalogs route to exact native contexts',()=>{
  assert.equal(taskTargetModule({type:'document',id:'asset-1',context:{catalog:'fonciere',projectId:'project-1'}}),'fonciere');
  assert.equal(taskTargetModule({type:'document',id:'asset-2',context:{catalog:'presentation',projectId:'presentation-1'}}),'izord');
  assert.equal(taskTargetModule({type:'document',id:'storage/path',context:{provider:'storage'}}),'documents');
});
test('malformed URLs do not select a record or supply preview data',()=>{
  for(const raw of ['x','null','[]','{"type":"unknown","id":"id"}','{"type":"contact","id":""}','{"type":"contact","id":"id","context":[]}'])assert.equal(readTaskTarget('/?crmTarget='+encodeURIComponent(raw)),null);
  assert.deepEqual(readTaskTarget('/?crmTarget='+encodeURIComponent(JSON.stringify({type:'contact',id:'id',label:'private title',url:'https://forged.invalid'}))),{type:'contact',id:'id'});
});
