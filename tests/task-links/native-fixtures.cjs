require('../i18n/register-typescript.cjs');
const{createFonciereData,FONCIERE_SCHEMA}=require('../../lib/fonciere/model.ts');const{createProjectData}=require('../../lib/izord/model.ts');
exports.foncierePayload=()=>{const data=createFonciereData();data.name='Projet Foncière fictif';data.city='Antibes';data.agencyReference='FON-FICTIF-24';data.presentationData.photos={main:'',view:'',inside:'',operation:''};return{schema:FONCIERE_SCHEMA,data,sourceDocuments:[]};};
exports.presentationPayload=()=>{const data=createProjectData();data.state.project='Présentation fictive révision 1';data.photos={main:'',view:'',inside:'',operation:''};return{schema:'IZORD_GENERATOR_V1',data,sourceDocuments:[]};};
