/** Finance functions ported verbatim from the audited v3 HTML, with TypeScript annotations only.
 * Source SHA-256: 8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1
 * Provisions and dated legal caveats are original tool assumptions, not updated legal advice. */
import type { ProjectState } from "./model";
export type RentalScenario = { rate:number|null; count:number|null; management:number|null; costs:number|null; gross:number|null; fee:number|null; net:number|null; issue:string; reviewed:boolean };
export type Calculation = ReturnType<typeof calculate>;
export const BASE={rentalMode:'seasonal',monthly:'',rentedMonths:'12',rentalPeriod:'12',annualManagement:'0',annualRentalCosts:'',annualCostsReviewed:false,seasonalCostsReviewed:false,acq:'',works:'',resale:'',weekly:'',asking:'',notaryRate:'2',notaryQuote:'',regime:'mdb',resaleBasis:'net',saleRate:'0',contingency:'0',finance:'',carrying:'',furniture:'',otherCosts:'',holding:'12',weeks:'8',management:'0',rentalCosts:'',costsReviewed:false,includePhotoSlide:true,project:'',ref:'',address:'',type:'',sea:'À confirmer',land:'',area:'',mainLabel:'Logement principal / maison 1',mainArea:'',secondLabel:'Maison 2 / logement annexe',secondArea:'',annexLabel:'Autres annexes, hors total',annexArea:'À préciser',measurement:'',features:'',propertyWarnings:'',source:'',program:'',decisionNotes:'',decision:'À renseigner',agencyFee:'',environment:''};
export const MONEY_FIELDS=['monthly','annualRentalCosts','acq','works','resale','weekly','asking','notaryQuote','finance','carrying','furniture','otherCosts','rentalCosts'];
export const RATE_FIELDS=['annualManagement','notaryRate','saleRate','contingency','management'];
export const ALL_NUM=[...MONEY_FIELDS,...RATE_FIELDS,'rentedMonths','rentalPeriod','weeks','holding','land','area','mainArea','secondArea'];
export const NAMES: Record<string, string>={monthly:'Loyer mensuel hors charges',rentedMonths:'Mois loués',rentalPeriod:'Période de comparaison locative',annualManagement:'Gestion de la location annuelle',annualRentalCosts:'Frais de la location annuelle',acq:'Acquisition espérée',works:'Budget de rénovation',resale:'Revente espérée',weekly:'Location saisonnière',asking:'Prix affiché',notaryQuote:'Devis notarial',finance:'Financement',carrying:'Portage',furniture:'Mobilier',otherCosts:'Autres frais',rentalCosts:'Coûts locatifs',notaryRate:'Provision notariale',saleRate:'Honoraires de revente',contingency:'Aléas',management:'Gestion locative',weeks:'Semaines louées',holding:'Durée de portage',land:'Surface du terrain',area:'Surface totale',mainArea:'Surface principale',secondArea:'Surface du second logement'};
export function number(v: unknown){if(v===null||v===undefined||String(v).trim()==='')return null;let t=String(v).trim().replace(/[\s\u00A0\u202F€]/g,'');if(/^[+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t))t=t.replace(/\./g,'');if(t.includes(',')&&t.includes('.'))return NaN;t=t.replace(',','.');if(!/^[+]?\d+(\.\d+)?$/.test(t))return NaN;const r=Number(t);return Number.isFinite(r)?r:NaN;}
export function finite(n: unknown): n is number{return typeof n==='number'&&Number.isFinite(n)}
export function round(n: number){return Math.round((n+Number.EPSILON)*100)/100;}
export function fmt(n: unknown,d=0){return finite(n)?new Intl.NumberFormat('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d}).format(n).replace(/\u202f/g,' '):'—'}
export function eur(n: unknown){return finite(n)?fmt(n)+' €':'À renseigner'}
export function pct(n: unknown){return finite(n)?fmt(n,1)+' %':'—'}
export function escapeHTML(s: unknown){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] ?? c));}
export function shortNum(n: unknown){return finite(n)?fmt(n,2).replace(/,00$/,''):'';}
export function errorsFor(s: ProjectState){const errors=[];for(const k of ALL_NUM){const n=number(s[k]);if(n!==null&&!finite(n)){errors.push(NAMES[k]+' : utilisez un nombre positif, sans lettres.');continue;}if(finite(n)&&n<0)errors.push(NAMES[k]+' : montant négatif non admis.');if(['acq','resale','notaryQuote'].includes(k)&&n===0)errors.push(NAMES[k]+' : le prix doit être supérieur à zéro.');if(RATE_FIELDS.includes(k)&&finite(n)&&n>=100)errors.push(NAMES[k]+' : le taux doit être inférieur à 100 %.');if(k==='weeks'&&finite(n)&&n>520)errors.push('Nombre de semaines supérieur à 520 : vérifiez la durée.');if(MONEY_FIELDS.includes(k)&&finite(n)&&n>999999999)errors.push(NAMES[k]+' : montant supérieur à la capacité de la fiche (999 999 999 €).');}if(!['seasonal','annual','compare'].includes(s.rentalMode||'seasonal'))errors.push('Mode de location non reconnu.');const period=number(s.rentalPeriod??12);if(period!==null&&finite(period)&&(period<=0||period>120))errors.push('Période de comparaison : entre 0 et 120 mois, hors zéro.');return errors;}
export function calculate(s: ProjectState){
 const n: Record<string, number|null>={};for(const k of ALL_NUM)n[k]=number(s[k]);
 const valid=errorsFor(s).length===0,mode=s.rentalMode||'seasonal';
 const acq=finite(n.acq)&&n.acq>0?n.acq:null,works=finite(n.works)?n.works:null,resale=finite(n.resale)&&n.resale>0?n.resale:null;
 const v=(k: string)=>finite(n[k])?n[k]:0;
 const fee=acq===null?null:finite(n.notaryQuote)?n.notaryQuote:s.regime==='mdb'&&finite(n.notaryRate)?round(acq*n.notaryRate/100):null;
 const extra=works===null?null:round(works*v('contingency')/100);
 const saleFee=s.resaleBasis==='net'?0:resale===null?null:round(resale*v('saleRate')/100);
 let total=acq!==null&&works!==null&&fee!==null&&extra!==null&&saleFee!==null?round(acq+works+fee+extra+v('finance')+v('carrying')+v('furniture')+v('otherCosts')+saleFee):null;
 let margin=total!==null&&resale!==null?round(resale-total):null;
 const period=number(s.rentalPeriod??'12');
 const periodOK=finite(period)&&period>0&&period<=120;
 const maxWeeks=periodOK?52*period/12:0;
 // Each option uses actual rented periods. Missing rents/occupation remain unknown, not zero.
 function scenario(rate: number|null,count: number|null,management: number|null,costs: number|null,limit: number,reviewed: boolean){
   const issue=!periodOK?'Période de comparaison à renseigner.':finite(count)&&count>limit+1e-8?'Occupation supérieure à la période étudiée.':'';
   const ready=valid&&!issue&&finite(rate)&&(rate===0||finite(count));
   const gross=ready?round(rate*(finite(count)?count:0)):null;
   const fee=gross===null?null:round(gross*(finite(management)?management:0)/100);
   const net=gross===null?null:round(gross-(fee as number)-(finite(costs)?costs:0));
   return {rate,count,management,costs,gross,fee,net,issue,reviewed:reviewed===true};
 }
 const seasonal=scenario(n.weekly,n.weeks,n.management,n.rentalCosts,maxWeeks,s.seasonalCostsReviewed);
 const annual=scenario(n.monthly,n.rentedMonths,n.annualManagement,n.annualRentalCosts,periodOK?period:0,s.annualCostsReviewed);
 const selected=mode==='annual'?annual:mode==='seasonal'?seasonal:null;
 const combinedOK=periodOK&&finite(n.holding)&&n.holding>0&&period<=n.holding+1e-8;
 let rent=selected?.gross??null,rentMgmt=selected?.fee??null,rentNet=selected?.net??null;
 if(!valid)total=margin=rent=rentMgmt=rentNet=null;
 const combinedFor=(sc: RentalScenario)=>combinedOK&&margin!==null&&sc.net!==null?round(margin+sc.net):null;
 const combinedSeasonal=combinedFor(seasonal),combinedAnnual=combinedFor(annual);
 const combined=mode==='annual'?combinedAnnual:mode==='seasonal'?combinedSeasonal:null;
 const delta=seasonal.net!==null&&annual.net!==null?round(annual.net-seasonal.net):null;
 return {n,valid,mode,period,periodOK,acq,works,resale,fee,extra,saleFee,total,margin,marginPct:total!==null&&total>0&&margin!==null?margin/total*100:null,seasonal,annual,delta,combinedOK,combinedSeasonal,combinedAnnual,rent,rentMgmt,rentNet,combined,
 discount:finite(n.asking)&&n.asking>0&&acq!==null?round(n.asking-acq):null,discountPct:finite(n.asking)&&n.asking>0&&acq!==null?(n.asking-acq)/n.asking*100:null};
}
export function rentalRateLines(s: ProjectState){
 const weekly=number(s.weekly),monthly=number(s.monthly);
 return (finite(weekly)?fmt(weekly)+' €/sem.':'Sais. : à renseigner')+(finite(weekly)&&finite(number(s.weeks))?' · '+fmt(number(s.weeks))+' sem.':'')+'\n'+(finite(monthly)?fmt(monthly)+' €/mois':'Ann. : à renseigner')+(finite(monthly)&&finite(number(s.rentedMonths))?' · '+fmt(number(s.rentedMonths))+' mois':'');
}
export function rentalExportIssues(r: Calculation){
 const use=r.mode==='compare'?[r.seasonal,r.annual]:[r.mode==='annual'?r.annual:r.seasonal];
 return use.filter(sc=>sc.issue&&finite(sc.rate)).map(sc=>sc.issue+' Corrigez les semaines ou les mois loués.');
}
export function rentalNotes(s: ProjectState,r: Calculation){
 const row=(title: string,sc: RentalScenario,combined: number|null)=>[title+' — loyers bruts : '+eur(sc.gross)+' ; gestion : '+eur(sc.fee)+' ; autres frais : '+eur(finite(sc.costs)?sc.costs:0)+' ; contribution : '+eur(sc.net),title+' — frais vérifiés : '+(sc.reviewed?'oui':'non, montant provisoire'),title+' — revente + contribution locative : '+eur(combined)];
 return [...row('Saisonnier',r.seasonal,r.combinedSeasonal),...row('Annuel',r.annual,r.combinedAnnual),'Écart annuel − saisonnier, après seuls frais saisis : '+eur(r.delta),'Les options sont alternatives, jamais cumulées. Aucun revenu locatif n’est compté dans la marge de revente hors loyers.','Le résultat revente + location est indicatif : charges et calendrier doivent être alignés sur la détention. Il n’est pas affiché lorsque la période de comparaison excède le portage.'];
}
