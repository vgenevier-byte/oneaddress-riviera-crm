require('../i18n/register-typescript.cjs');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {moduleItems,emptyGrants,moduleSensitivePermissions}=require('../../lib/access/modules');
const {allowedNavigation,navigationGroups}=require('../../components/unifiedNavigationStructure');
const {accessMessages}=require('../../lib/i18n/catalogs/access');
const flatten=access=>allowedNavigation(access).flatMap(entry=>entry.kind==='module'?[entry.item.tab]:entry.items.map(item=>item.tab));
const access=grants=>({active:true,revision:1,generalAdmin:false,fullAccess:false,modules:{...emptyGrants(),...grants}});
test('every administrable module appears exactly once in complete navigation; special admin and personnel subviews remain distinct',()=>{
 const ids=moduleItems.map(item=>item.tab);assert.equal(ids.filter(id=>id==='monthlyCharges').length,1);assert.equal(ids.filter(id=>id==='fonciere').length,1);assert(!ids.includes('admin'));for(const id of ['hours','payments','packages'])assert(!ids.includes(id));
 const visible=flatten(access(Object.fromEntries(ids.map(id=>[id,{level:'contribute',sensitive:{}}]))));assert.equal(new Set(visible).size,visible.length);assert.deepEqual([...visible].sort(),[...ids].sort());
 assert.deepEqual(navigationGroups.find(group=>group.id==='fonciere').modules,['fonciere','izord']);assert.deepEqual(moduleSensitivePermissions('fonciere'),['delete','export']);
});
test('each visible module and navigation group has explicit French and English administration labels',()=>{
 for(const key of [...moduleItems.map(item=>'navigation.module.'+item.tab),...navigationGroups.map(group=>'navigation.group.'+group.id)])for(const language of ['fr','en'])assert.equal(typeof accessMessages[key]?.[language],'string',key+' '+language);
});
for(const [project,presentation] of [[false,false],[true,false],[false,true],[true,true]])test(`independent navigation Projets=${project} Présentations=${presentation}`,()=>{
 const visible=flatten(access({fonciere:{level:project?'read':'none',sensitive:{}},izord:{level:presentation?'read':'none',sensitive:{}}}));assert.equal(visible.includes('fonciere'),project);assert.equal(visible.includes('izord'),presentation);
});
