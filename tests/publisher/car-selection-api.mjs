/** Actual local API + PostgreSQL; Auth/RPC/providers are isolated simulations. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { directory, trace, sql, request as rawRequest } from './car-selection-local.mjs';
import { CAR_CATALOGUE, CAR_CATALOGUE_VERSION, CAR_TYPES, availableCarBrands, availableCarModels } from '../../lib/publisher/carSelection.js';
const results=[];
const request=(action,body,who='other',query={})=>rawRequest(action,body,who,query);
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const core={universe:'cars',moment:'day',style:'elegant'};
const protectedId='19394aed-b069-48dc-ac8d-cdbddfffd93c';
let explicit, explicitBody, firstScene;
const created=[];
const callsFor=id=>trace().filter(call=>call.requestId===id);
async function create(direction,requestId=randomUUID()){
  const body={requestId,mode:'guided',direction:{...core,...direction}};
  const response=await request('generate',body);
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.equal(response.data.state,'ready');created.push(response.data.post.id);
  return {post:response.data.post,body};
}
function assertBoundary(body,post){
  const reference=CAR_CATALOGUE.find(candidate=>candidate.id===post.car_context.referenceId);
  assert.ok(reference,'Resolved reference belongs to the current verified catalogue');
  assert.equal(post.car_context.catalogueVersion,CAR_CATALOGUE_VERSION);
  for(const field of ['manufacturer','model','variant','generation','visualFeatures'])assert.deepEqual(post.car_context[field],reference[field],`Canonical ${field} must match the exact catalogue reference`);
  const calls=callsFor(body.requestId);
  assert.equal(calls.filter(c=>c.kind==='responses').length,2);
  assert.equal(calls.filter(c=>c.kind==='images').length,1);
  for(const call of calls)assert.deepEqual(call.carContextBeforeCall,post.car_context,'Canonical choices must already be in the real journal before every simulated provider call');
  const image=calls.find(c=>c.kind==='images').request;
  assert.match(image.prompt,new RegExp(post.car_context.referenceId));
  assert.match(image.prompt,new RegExp(post.car_context.model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(image.prompt,/generation-specific|bonnet-to-cabin/);
  assert.match(image.prompt,/contact shadows/);
  assert.doesNotMatch(image.prompt,/Client Fake|Six Wheel Phantom/);
  assert.equal(image.model,'gpt-image-2');assert.equal(image.quality,'medium');assert.equal(image.n,1);
  assert.ok(['1024x1280','1024x1536'].includes(image.size));
}
await sql.connect();
try{
  await check('protected historical fixture keeps every original field and the exact old context',async()=>{
    const before=JSON.parse(readFileSync(`${directory}/protected-historical-before.json`));
    const row=(await sql.query('select to_jsonb(p) row from publisher_posts p where id=$1',[protectedId])).rows[0].row;
    assert.deepEqual(row,before);assert.equal(Object.keys(row.car_context).length,9);
    const reply=await request('status',undefined,'other',{id:protectedId});assert.equal(reply.status,200);assert.deepEqual(reply.data.post.car_context,before.car_context);
  });
  await check('anonymous, read-only and no-access sessions cannot generate or enter the journal',async()=>{
    const before=trace().length;
    for(const [who,status] of [[null,401],['reader',403],['none',403]]){
      const id=randomUUID();const r=await request('generate',{requestId:id,mode:'guided',direction:{...core,carType:'suv'}},who);
      assert.equal(r.status,status);assert.equal((await sql.query('select 1 from publisher_operations where request_id=$1',[id])).rowCount,0);
    }assert.equal(trace().length,before);
  });
  await check('falsified identifiers, types and incompatible combinations return clear 400 before provider/admission',async()=>{
    const before=trace().length;
    const incompatibleTypeBrand=CAR_TYPES.filter(type=>type!=='auto').flatMap(carType=>availableCarBrands('auto').map(brand=>({carType,carBrand:brand.id}))).find(({carType,carBrand})=>!availableCarBrands(carType).some(brand=>brand.id===carBrand));
    assert.ok(incompatibleTypeBrand,'Catalogue retains a genuinely incompatible type/brand pair for admission checks');
    const invalid=[
      {carType:'tank'},{carType:null},{carType:3},{carType:{}},
      {carBrand:'six-wheel-phantom'},{carBrand:null},{carBrand:1},{carBrand:{}},
      {carModel:'phantom-client'},{carModel:null},{carModel:[]},
      incompatibleTypeBrand,
      {carType:'convertible',carBrand:'porsche',carModel:'porsche-911-carrera-coupe-2024'},
      {carType:'coupe_gt',carBrand:'porsche',carModel:'bentley-continental-gt-speed-gen4'},
      {carType:'suv',carBrand:'auto',carModel:'range-rover-l460-swb-se'},
    ];
    for(const selection of invalid){const id=randomUUID();const r=await request('generate',{requestId:id,mode:'guided',direction:{...core,...selection}});assert.equal(r.status,400,JSON.stringify(r.data));assert.match(r.data.error,/voiture|automobile|marque|modèle/i);assert.equal((await sql.query('select 1 from publisher_operations where request_id=$1',[id])).rowCount,0);}
    assert.equal(trace().length,before);
  });
  await check('type alone resolves a specific catalogue reference and saves all requested defaults',async()=>{
    const {post,body}=await create({carType:'suv'});assert.ok(CAR_CATALOGUE.filter(reference=>reference.types.includes('suv')).some(reference=>reference.id===post.car_context.referenceId));assert.equal(post.car_context.requestedType,'suv');assert.equal(post.car_context.resolvedType,'suv');assert.equal(post.car_context.requestedBrand,'auto');assert.equal(post.car_context.requestedModel,'auto');assertBoundary(body,post);
  });
  await check('type plus brand resolves only a compatible model from that brand',async()=>{
    const {post,body}=await create({carType:'convertible',carBrand:'porsche'});assert.ok(availableCarModels('convertible','porsche').some(reference=>reference.id===post.car_context.referenceId));assert.equal(post.car_context.requestedType,'convertible');assert.equal(post.car_context.resolvedType,'convertible');assert.equal(post.car_context.manufacturer,'Porsche');assert.equal(post.car_context.requestedBrand,'porsche');assert.equal(post.car_context.requestedModel,'auto');assertBoundary(body,post);
  });
  await check('type brand and model resolve the exact chosen body/generation even with supplied fake context',async()=>{
    const {post,body}=await create({carType:'coupe_gt',carBrand:'bentley',carModel:'bentley-continental-gt-speed-gen4',manufacturer:'Client Fake',model:'Six Wheel Phantom',car_context:{referenceId:'client'},image_prompt:'fictional Six Wheel Phantom'});
    assert.equal(post.car_context.referenceId,'bentley-continental-gt-speed-gen4');assert.equal(post.car_context.requestedModel,post.car_context.referenceId);assert.match(post.car_context.variant,/fixed roof/);assert.match(post.car_context.generation,/Fourth/);assertBoundary(body,post);
  });
  await check('legacy all-auto payload always resolves a precise real model and retains its legacy fingerprint',async()=>{
    const {post,body}=await create({});assert.equal(post.car_context.requestedType,'auto');assert.equal(post.car_context.requestedBrand,'auto');assert.equal(post.car_context.requestedModel,'auto');assert.ok(post.car_context.referenceId);assertBoundary(body,post);
    const canonical={requestId:body.requestId,mode:'guided',direction:{universe:'cars',moment:'day',style:'elegant',carType:'auto'}};
    const expected=createHash('sha256').update(JSON.stringify({action:'generate',body:canonical})).digest('hex');
    const row=(await sql.query('select fingerprint from publisher_operations where request_id=$1',[body.requestId])).rows[0];assert.equal(row.fingerprint,expected);
    const n=trace().length;const replay=await request('generate',{...body,direction:{...body.direction,carType:'auto',carBrand:'auto',carModel:'auto'}});assert.equal(replay.status,200);assert.equal(replay.data.post.id,post.id);assert.equal(trace().length,n);
  });
  await check('double click claims one exact model, one image and one canonical durable context',async()=>{
    explicitBody={requestId:randomUUID(),mode:'guided',direction:{...core,carType:'sports_car',carBrand:'porsche',carModel:'porsche-911-carrera-coupe-2024'}};
    const replies=await Promise.all([request('generate',explicitBody),request('generate',explicitBody)]);
    for(const reply of replies)assert.ok([200,202].includes(reply.status),JSON.stringify(reply.data));
    explicit=replies.find(r=>r.data?.post)?.data.post;if(!explicit)explicit=(await request('status',undefined,'other',{requestId:explicitBody.requestId})).data.post;
    assert.ok(explicit);created.push(explicit.id);firstScene=explicit.scene_summary;assertBoundary(explicitBody,explicit);
    const journal=(await sql.query('select car_context from publisher_operations where request_id=$1',[explicitBody.requestId])).rows[0];const row=(await sql.query('select car_context from publisher_posts where id=$1',[explicit.id])).rows[0];assert.deepEqual(row.car_context,journal.car_context);assert.deepEqual(row.car_context,explicit.car_context);
  });
  await check('changed compatible brand/model or actor conflicts on the same request without any extra call',async()=>{
    const n=trace().length;
    assert.equal((await request('generate',{...explicitBody,direction:{...explicitBody.direction,carModel:'porsche-911-carrera-cabriolet-2024'}})).status,409);
    assert.equal((await request('generate',{...explicitBody,direction:{...explicitBody.direction,carBrand:'lamborghini',carModel:'lamborghini-huracan-evo-coupe-2019'}})).status,409);
    assert.equal((await request('generate',explicitBody,'editor')).status,409);assert.equal(trace().length,n);
  });
  await check('lost response status and replay recover the same saved choices without provider calls',async()=>{
    const n=trace().length;const status=await request('status',undefined,'other',{requestId:explicitBody.requestId});const replay=await request('generate',explicitBody);assert.equal(status.data.post.id,explicit.id);assert.deepEqual(replay.data.post.car_context,explicit.car_context);assert.equal(trace().length,n);
  });
  await check('five creations keep the explicitly chosen model with a growing real local history',async()=>{
    const scenes=[firstScene];for(let i=0;i<4;i++){const {post,body}=await create(explicitBody.direction);assert.deepEqual(post.car_context,explicit.car_context);assertBoundary(body,post);scenes.push(post.scene_summary);}assert.equal(new Set(scenes).size,5,'No artificial four-scene metadata ceiling');
  });
  await check('text regeneration preserves exact context image format and music selection',async()=>{
    const fields='car_context,image_url,image_pathname,image_etag,image_width,image_height,format,music_used_id,primary_music_id,alternative_music_ids';const before=(await sql.query(`select ${fields} from publisher_posts where id=$1`,[explicit.id])).rows[0];
    const id=randomUUID();const reply=await request('regenerate-text',{requestId:id,id:explicit.id,revision:explicit.revision});assert.equal(reply.status,200,JSON.stringify(reply.data));explicit=reply.data.post;const after=(await sql.query(`select ${fields} from publisher_posts where id=$1`,[explicit.id])).rows[0];assert.deepEqual(after,before);assert.equal(callsFor(id).filter(c=>c.kind==='responses').length,1);assert.equal(callsFor(id).filter(c=>c.kind==='images').length,0);
  });
  await check('image regeneration preserves exact requested selection, body and generation',async()=>{
    const before={context:explicit.car_context,caption:explicit.caption,music:explicit.music,format:explicit.format};const id=randomUUID();const reply=await request('regenerate-image',{requestId:id,id:explicit.id,revision:explicit.revision});assert.equal(reply.status,200,JSON.stringify(reply.data));explicit=reply.data.post;assert.deepEqual(explicit.car_context,before.context);assert.equal(explicit.caption,before.caption);assert.deepEqual(explicit.music,before.music);assert.equal(explicit.format,before.format);
    const calls=callsFor(id);assert.equal(calls.filter(c=>c.kind==='responses').length,1);assert.equal(calls.filter(c=>c.kind==='images').length,1);for(const call of calls)assert.deepEqual(call.carContextBeforeCall,before.context);
  });
  await check('history reread returns the exact new selection and only authorized media is served',async()=>{
    const reply=await request('history');const saved=reply.data.posts.find(p=>p.id===explicit.id);assert.deepEqual(saved.car_context,explicit.car_context);assert.equal((await request('image',undefined,'other',{id:explicit.id})).status,200);assert.equal((await request('image',undefined,'none',{id:explicit.id})).status,403);
  });
  await check('all other universes ignore car-only fields and retain formats English captions music and locations',async()=>{
    for(const universe of ['landscapes','real_estate','boats']){const {post}=await create({universe,carType:'untrusted-ignored',carBrand:null,carModel:{evil:true}});assert.equal(post.car_context,undefined);assert.equal(post.hashtags.length,5);assert.equal(post.music.length,3);assert.match(post.caption,/^The coast/);assert.equal(post.format,universe==='boats'?'Reel':'Feed 4:5');if(universe==='real_estate')assert.equal(post.location,'Aucun');}
  });
  await check('existing historical contexts and music rows remain unchanged after all new selections and regenerations',async()=>{
    const before=JSON.parse(readFileSync(`${directory}/protected-historical-before.json`));const after=(await sql.query('select to_jsonb(p) row from publisher_posts p where id=$1',[protectedId])).rows[0].row;assert.deepEqual(after,before);assert.equal(Object.keys(after.car_context).length,9);assert.equal((await sql.query('select count(*)::int n from publisher_music')).rows[0].n,90);
    assert.equal((await sql.query("select count(*)::int n from publisher_operations where state='running'")).rows[0].n,0);
    assert.equal((await sql.query("select count(*)::int n from publisher_posts where status='published'")).rows[0].n,0);
  });
  const exactImage=callsFor(explicitBody.requestId).find(c=>c.kind==='images').request;
  writeFileSync(`${directory}/selection-prompt-example.txt`,exactImage.prompt+'\n');
  writeFileSync(`${directory}/selection-api-results.json`,JSON.stringify({passed:results.length,results,createdPostIds:created,reference:explicit.car_context,database:'native PostgreSQL local only',auth:'simulated',providers:'simulated with real transport request capture',paidCalls:0},null,2)+'\n');
  console.log(`${results.length} local API/database checks passed; zero paid calls`);
}finally{await sql.end();}
