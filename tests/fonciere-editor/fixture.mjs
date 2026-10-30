/** Fictional local project only; no production environment is loaded. */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {connect,sql,fixtureFile,ok,login,payload} from '../fonciere-arbitrage/local.mjs';
await connect();try {const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),admin=await login(fixture.users.admin),source=payload('Villa fictive — correction éditeurs');Object.assign(source.data,{rooms:'6',agentPhone:'0102030405',agentEmail:'agent@example.invalid'});source.data.guided.values={propertyType:'villa',rooms:6};fixture.projects.editorState=await ok(admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:source,p_contact:'',p_agency_contact:''}));writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});console.log('Prepared fictional editor regression project.');}finally{await sql.end();}
