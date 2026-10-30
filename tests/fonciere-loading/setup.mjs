/** Guarded real local Auth/RPC/Storage, deterministic fictional photographs. */
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {connect,sql,fixtureFile,login,createFonciereRepository} from '../fonciere-arbitrage/local.mjs';
const require=createRequire(import.meta.url),{createFonciereData}=require('../../lib/fonciere/model'),{createOwnerPerson}=require('../../lib/fonciere/owners');
await connect();try{const fixture=JSON.parse(readFileSync(fixtureFile,'utf8'));if(fixture.performance&&!process.argv.includes('--new')){console.log('Existing immutable benchmark fixtures retained');process.exitCode=0;}else{
 const admin=await login(fixture.users.admin),repo=createFonciereRepository(admin.client),images=[];let seed=437091;
 for(let i=0;i<24;i++){const pixels=Buffer.alloc(1600*1066*3);for(let p=0;p<pixels.length;p++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[p]=((p%1600)+i*17+(seed>>>26)*2)%256;}const bytes=await sharp(pixels,{raw:{width:1600,height:1066,channels:3}}).jpeg({quality:86}).toBuffer();images.push({bytes,data:'data:image/jpeg;base64,'+bytes.toString('base64')});}
 const records=[];for(let repetition=1;repetition<=3;repetition++)for(const count of [0,6,24]){const d=createFonciereData();d.name=`Mesure fictive ${count} photos R${repetition}`;d.city='Cannes';d.propertyAddress='Adresse fictive de mesure';d.description='Informations fictives de consultation. '.repeat(120);d.guided.values={propertyType:'villa',askingPrice:1000000,area:160,rooms:6};d.ownerContext.owners=[{contactId:fixture.owners.person1,entityType:'person',note:'Fictif',person:createOwnerPerson()}];d.agencyContactId=fixture.owners.company;d.agentContactId=fixture.owners.representative;d.agencyName='Agence fictive';d.agentName='Interlocuteur fictif';
  d.presentationData.importGallery=images.slice(0,count).map((p,i)=>({data:p.data,label:`Photo fictive ${i+1}`,source:'Fixture locale',page:null,width:1600,height:1066}));if(count)for(const [i,role]of ['main','view','inside','operation'].entries()){d.presentationData.photos[role]=images[i].data;d.presentationData.photoGalleryRoles[role]=i;}
  const saved=await repo.saveProject({data:d,creationKey:randomUUID()});records.push({id:saved.project.id,name:d.name,count,repetition,originalBytes:images.slice(0,count).reduce((n,p)=>n+p.bytes.length,0)});console.log('Prepared '+d.name);
 }
 fixture.performance={records,description:'1600x1066 JPEG quality 86; 0/6/24 distinct originals; four role assignments reuse gallery originals; 3 repetitions; same projects before/after',authorizedProjects:Number((await sql.query('select count(*) from fonciere_projects')).rows[0].count)};writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});console.log('PASS nine comparable benchmark records prepared');
}}finally{await sql.end();}
