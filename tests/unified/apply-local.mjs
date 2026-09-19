import {readFileSync} from 'node:fs';
import {connect,sql,dir} from './local.mjs';
await connect();try{await sql.query(readFileSync(dir+'/iteration.sql','utf8'));console.log('Définitions locales mises à jour.');}finally{await sql.end();}
