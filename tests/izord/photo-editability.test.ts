/** Transport doubles prove editability invariants; real Auth/Storage/browser
 * preservation is exercised separately by the photo correction campaign. */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectData } from "../../lib/izord/model";
import { canEditLoadedProject, createGeneratorRepository, photoDataToBlob, type LoadedProject, type ProjectRecord } from "../../lib/izord/repository";
const projectId="11111111-1111-4111-8111-111111111111",owner="22222222-2222-4222-8222-222222222222";
const photoIds=["33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444"];
function harness(deniedPhoto=false,identicalBytes=false,placeholderBytes=false){
  const remote=createProjectData();remote.state.project="Dossier photographié fictif";
  remote.photos={main:photoIds[0],view:"",inside:photoIds[1],operation:""};
  remote.importGallery=photoIds.map((data,index)=>({data,label:`Photographie fictive ${index+1}`,page:null,width:160,height:120,source:""}));remote.photoGalleryRoles={main:0,inside:1};
  let payload={schema:"IZORD_GENERATOR_V1",data:remote,sourceDocuments:["55555555-5555-4555-8555-555555555555"]},revision=7;
  const project=():ProjectRecord=>({id:projectId,owner_id:owner,title:"Dossier photographié fictif",revision,status:"draft",created_at:"2026-10-24T00:00:00Z",updated_at:"2026-10-24T00:00:00Z",payload});
  const calls:{name:string;args?:Record<string,unknown>}[]=[],downloads:string[]=[];
  const client={auth:{getUser:async()=>({data:{user:{id:owner}},error:null}),getSession:async()=>({data:{session:{user:{id:owner}}}})},
    storage:{from:()=>({download:async(path:string)=>{downloads.push(path);if(deniedPhoto)return{data:null,error:{code:"42501"}};const index=photoIds.indexOf(path.split("/")[1]);return{data:new Blob([photoDataToBlob(createProjectData().photos.main),new Uint8Array(placeholderBytes?[]:[identicalBytes?1:index+1])],{type:"image/jpeg"}),error:null};}})},
    rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});if(name==="izord_save_generator"){payload=structuredClone(args.p_payload) as typeof payload;revision++;}return{data:revision,error:null};},
    from:(table:string)=>{const rows=table==="izord_projects"?[project()]:table==="izord_assets"?photoIds.map(id=>({id,project_id:projectId,project_revision:7,object_path:`${projectId}/${id}`,kind:"photo",lifecycle:"finalized",expected_size:null})): [{project_id:projectId,revision,author_id:owner,title:"Révision fictive",status:"draft",payload}];
      const query={select:()=>query,eq:()=>query,order:()=>query,single:async()=>({data:rows[0],error:null}),then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve,reject)};return query;},};
  return{repository:createGeneratorRepository(client as unknown as SupabaseClient),calls,downloads,current:project,payload:()=>payload};
}
test("omitted photo loads remain view-only and are refused before any save mutation",async()=>{
  const h=harness(),view=await h.repository.loadProject(projectId,{hydratePhotos:false});
  assert.equal(view.photoHydration,"omitted");assert.equal(view.historicalRevision,null);assert.equal(canEditLoadedProject(view),false);assert.deepEqual(view.data.importGallery,[]);assert.equal(h.downloads.length,0);
  await assert.rejects(h.repository.saveProject({project:view.project,data:view.data,previous:view}),/lecture seule/);assert.equal(h.calls.length,0);
  await assert.rejects(h.repository.saveProject({project:view.project,data:view.data}),/lecture seule/);assert.equal(h.calls.length,0);
});
test("historical snapshot is read-only with omitted or complete photo bytes",async()=>{
  const h=harness();for(const hydratePhotos of[false,true]){const view=await h.repository.loadProject(projectId,{revision:7,hydratePhotos});assert.equal(view.historicalRevision,7);assert.equal(canEditLoadedProject(view),false);await assert.rejects(h.repository.saveProject({project:view.project,data:view.data,previous:view}),/lecture seule/);}assert.equal(h.calls.length,0);
});
test("current reload after a view hydrates all photos; text-only save preserves exact saved image identities and roles",async()=>{
  const h=harness();await h.repository.loadProject(projectId,{revision:7,hydratePhotos:false});const before=structuredClone(h.payload());
  const current=await h.repository.loadProject(projectId,{hydratePhotos:true});assert.equal(canEditLoadedProject(current),true);assert.equal(h.downloads.length,2);assert.equal(current.data.importGallery.length,2);assert(current.data.photos.main.startsWith("data:image/jpeg;base64,"));
  const data=structuredClone(current.data);data.state.project="Titre fictif modifié";const saved=await h.repository.saveProject({project:current.project,data,previous:current});assert.equal(canEditLoadedProject(saved),true);assert.equal(h.calls.length,1,"No photo registration/upload for unchanged images");assert.deepEqual(h.payload().data.photos,before.data.photos);assert.deepEqual(h.payload().data.importGallery,before.data.importGallery);assert.deepEqual(h.payload().data.photoGalleryRoles,before.data.photoGalleryRoles);assert.deepEqual(h.payload().sourceDocuments,before.sourceDocuments);
});
test("an unavailable photo prevents a complete load and cannot expose a savable partial result",async()=>{
  const h=harness(true);await assert.rejects(h.repository.loadProject(projectId,{hydratePhotos:true}),/droits|révision/);assert.equal(h.calls.length,0);
});
test("missing completeness marker or another dossier/revision cannot supply an editable previous baseline",async()=>{
  const h=harness(),current=await h.repository.loadProject(projectId);const cases:LoadedProject[]=[{...current,photoHydration:undefined} as unknown as LoadedProject,{...current,project:{...current.project,id:"66666666-6666-4666-8666-666666666666"}},{...current,project:{...current.project,revision:6}}];
  for(const previous of cases)await assert.rejects(h.repository.saveProject({project:current.project,data:current.data,previous}),/lecture seule/);assert.equal(h.calls.length,0);
});

test("text-only save preserves distinct slot IDs even when multiple saved assets have identical bytes",async()=>{
  const h=harness(false,true),before=structuredClone(h.payload()),current=await h.repository.loadProject(projectId);
  assert.equal(current.data.photos.main,current.data.photos.inside);assert.notEqual(before.data.photos.main,before.data.photos.inside);
  const data=structuredClone(current.data);data.state.project="Titre modifié, mêmes images";
  await h.repository.saveProject({project:current.project,data,previous:current});
  assert.deepEqual(h.payload().data.photos,before.data.photos);assert.deepEqual(h.payload().data.importGallery,before.data.importGallery);assert.deepEqual(h.payload().data.photoGalleryRoles,before.data.photoGalleryRoles);assert.equal(h.calls.length,1);
});
test("an unchanged stored asset matching placeholder bytes retains its real reference",async()=>{
  const h=harness(false,true,true),before=structuredClone(h.payload()),current=await h.repository.loadProject(projectId);
  assert.equal(current.data.photos.main,createProjectData().photos.main);
  const data=structuredClone(current.data);data.state.project="Titre seul";await h.repository.saveProject({project:current.project,data,previous:current});
  assert.deepEqual(h.payload().data.photos,before.data.photos);assert.deepEqual(h.payload().data.importGallery,before.data.importGallery);assert.equal(h.calls.length,1);
});
