/** Annual operating alternatives. Dates refer to a 365-day reference year,
 * never to acquisition/holding periods. No financing, tax or resale fees. */
export type RentalUnit = "month" | "week" | "night" | "year";
export type RentalPeriod = { id: string; unit: RentalUnit; rate: number | null; rentedUnits: number | null; availability: number | null; occupancyPercent: number | null; start: string; end: string };
export type RentalAlternative = { id: string; name: string; mode: "long_term" | "seasonal" | "mixed" | "annual"; periods: RentalPeriod[]; management: number | null; operatingCosts: number | null; receiptDelayMonths: number | null };
export type RentalPlan = { version: 1; cost: { acquisition: number | null; acquisitionFees: number | null; works: number | null; other: number | null; confirmed: boolean }; referenceId: string | null; scenarios: RentalAlternative[] };
export function createRentalPlan(): RentalPlan { return { version: 1, cost: { acquisition: null, acquisitionFees: null, works: null, other: null, confirmed: false }, referenceId: null, scenarios: [] }; }
export function createRentalPeriod(): RentalPeriod { return { id: crypto.randomUUID(), unit: "month", rate: null, rentedUnits: null, availability: null, occupancyPercent: null, start: "", end: "" }; }
export function createRentalAlternative(): RentalAlternative { return { id: crypto.randomUUID(), name: "", mode: "long_term", periods: [createRentalPeriod()], management: null, operatingCosts: null, receiptDelayMonths: null }; }
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function keys(v: unknown, allowed: string[]): asserts v is Record<string, unknown> { if (!plain(v) || Object.keys(v).length !== allowed.length || Object.keys(v).some(k => !allowed.includes(k))) throw new Error("Structure locative invalide."); }
function amount(v: unknown, max = 1e12, integer = false): asserts v is number | null { if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max || integer && !Number.isInteger(v))) throw new Error("Valeur locative invalide."); }
const idValid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function annualDay(value: string): number | null { if (!/^\d{2}-\d{2}$/.test(value)) return null; const [m,d] = value.split("-").map(Number), days = [31,28,31,30,31,30,31,31,30,31,30,31]; return m>=1&&m<=12&&d>=1&&d<=days[m-1] ? days.slice(0,m-1).reduce((a,b)=>a+b,0)+d : null; }
export function periodCapacity(p: RentalPeriod): number | null { const start=annualDay(p.start),end=annualDay(p.end); if(start===null||end===null||end<start)return null; const days=end-start+1;if(p.unit==='night')return days;if(p.unit==='week')return Math.floor(days/7);if(p.unit==='year')return days===365?1:0;const [sm,sd]=p.start.split('-').map(Number),[em,ed]=p.end.split('-').map(Number);return sd===1&&ed===[31,28,31,30,31,30,31,31,30,31,30,31][em-1]?em-sm+1:null; }
export function rentalIssues(s: RentalAlternative): string[] {
 const issues:string[]=[];const windows:{start:number;end:number}[]=[];
 if(s.mode!=='mixed'&&s.periods.length!==1)issues.push('Une seule période est attendue hors mode mixte.');
 for(const p of s.periods){
  if(s.mode==='long_term'&&p.unit!=='month'||s.mode==='seasonal'&&!['night','week'].includes(p.unit)||s.mode==='annual'&&p.unit!=='year')issues.push('Unité incompatible avec le mode choisi.');
  const hasWindow=!!p.start||!!p.end;const start=annualDay(p.start),end=annualDay(p.end);
  if(hasWindow&&(start===null||end===null||end<start))issues.push('Complétez une fenêtre annuelle valide, sans retour sur l’année suivante.');
  if(s.mode==='mixed'&&!hasWindow)issues.push('Chaque période mixte nécessite une fenêtre annuelle.');
  if(start!==null&&end!==null){if(windows.some(w=>start<=w.end&&end>=w.start))issues.push('Les périodes se chevauchent.');windows.push({start,end});}
  const capacity=hasWindow?periodCapacity(p):({month:12,week:52,night:365,year:1}[p.unit]);
  if(hasWindow&&capacity===null&&p.unit==='month')issues.push('Une période mensuelle commence le premier jour et finit le dernier jour d’un mois.');
  if(capacity!==null&&[p.rentedUnits,p.availability].some(n=>n!==null&&n>capacity))issues.push('Les unités louées ou disponibles dépassent la fenêtre annuelle.');
  if(p.occupancyPercent!==null&&p.availability===null)issues.push('Renseignez la disponibilité avant le taux d’occupation.');
  if(p.rentedUnits!==null&&p.availability!==null&&p.rentedUnits>p.availability)issues.push('Les unités louées dépassent les unités disponibles.');
  if(p.occupancyPercent!==null&&p.availability!==null&&p.rentedUnits!==null&&Math.abs(p.availability*p.occupancyPercent/100-p.rentedUnits)>1e-7)issues.push('Corrigez les unités louées ou le taux : les deux saisies sont incohérentes.');
 }
 return [...new Set(issues)];
}
export function validateRentalPlan(raw: unknown, allowIssues = false): RentalPlan | null {
 if(raw===undefined||raw===null)return null;
 keys(raw,['version','cost','referenceId','scenarios']);if(raw.version!==1)throw new Error('Version locative invalide.');keys(raw.cost,['acquisition','acquisitionFees','works','other','confirmed']);for(const k of ['acquisition','acquisitionFees','works','other'])amount(raw.cost[k]);if(typeof raw.cost.confirmed!=='boolean')throw new Error('Confirmation du coût invalide.');
 if(!Array.isArray(raw.scenarios)||raw.scenarios.length>20)throw new Error('Vingt scénarios maximum.');const ids=new Set<string>();
 for(const s of raw.scenarios){keys(s,['id','name','mode','periods','management','operatingCosts','receiptDelayMonths']);if(!idValid(s.id)||ids.has(s.id)||typeof s.name!=='string'||s.name.length>120||!['long_term','seasonal','mixed','annual'].includes(String(s.mode))||!Array.isArray(s.periods)||s.periods.length<1||s.periods.length>12)throw new Error('Scénario locatif invalide.');ids.add(s.id);amount(s.management);amount(s.operatingCosts);amount(s.receiptDelayMonths,1200,true);const periods=new Set<string>();
  for(const p of s.periods){keys(p,['id','unit','rate','rentedUnits','availability','occupancyPercent','start','end']);if(!idValid(p.id)||periods.has(p.id)||!['month','week','night','year'].includes(String(p.unit))||typeof p.start!=='string'||typeof p.end!=='string'||p.start!==''&&annualDay(p.start)===null||p.end!==''&&annualDay(p.end)===null)throw new Error('Période locative invalide.');periods.add(p.id);amount(p.rate);amount(p.rentedUnits,365,true);amount(p.availability,365,true);amount(p.occupancyPercent,100);}
  const issues=rentalIssues(s as RentalAlternative);if(issues.length&&!allowIssues)throw new Error(issues.join(' '));
 }
 if(raw.referenceId!==null&&(typeof raw.referenceId!=='string'||!ids.has(raw.referenceId)))throw new Error('Scénario de référence invalide.');return structuredClone(raw) as RentalPlan;
}
export function commonRentalCost(plan: RentalPlan): number | null { const c=plan.cost,values=[c.acquisition,c.acquisitionFees,c.works,c.other];return c.confirmed&&values.every(v=>v!==null)?values.reduce<number>((a,b)=>a+(b??0),0):null; }
export function rentalResults(plan: RentalPlan) { const cost=commonRentalCost(plan);return plan.scenarios.map(s=>{const issues=rentalIssues(s);const gross=!issues.length&&s.periods.every(p=>p.rate!==null&&p.rentedUnits!==null)?s.periods.reduce((a,p)=>a+p.rate!*p.rentedUnits!,0):null;const afterFees=gross!==null&&s.management!==null&&s.operatingCosts!==null?gross-s.management-s.operatingCosts:null;return { id:s.id,name:s.name,reference:s.id===plan.referenceId,gross,management:s.management,operatingCosts:s.operatingCosts,afterFees,grossYield:gross!==null&&cost!==null&&cost>0?gross/cost*100:null,afterFeesYield:afterFees!==null&&cost!==null&&cost>0?afterFees/cost*100:null,issues };}); }
export function rentalComparisonRows(plan: RentalPlan,lang:'fr'|'en'='fr') { const fmt=(v:number|null,percent=false)=>v===null?(lang==='fr'?'À compléter':'To complete'):new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB',{maximumFractionDigits:2}).format(v)+(percent?' %':' €');return rentalResults(plan).map(r=>({label:r.name|| (lang==='fr'?'Scénario sans nom':'Unnamed scenario'),value:[r.reference?(lang==='fr'?'Référence':'Reference'):'',`${lang==='fr'?'Recettes':'Revenue'} ${fmt(r.gross)}`,`${lang==='fr'?'Gestion':'Management'} ${fmt(r.management)}`,`${lang==='fr'?'Exploitation':'Operating costs'} ${fmt(r.operatingCosts)}`,`${lang==='fr'?'Après frais renseignés':'After entered fees'} ${fmt(r.afterFees)}`,`${lang==='fr'?'Rendement brut':'Gross yield'} ${fmt(r.grossYield,true)}`,`${lang==='fr'?'Après frais':'After fees'} ${fmt(r.afterFeesYield,true)}`].filter(Boolean).join(' · ')})); }
export function rentalAssumptionRows(plan: RentalPlan, lang:'fr'|'en'='fr') {
 const t=(fr:string,en:string)=>lang==='fr'?fr:en;
 const fmt=(v:number|null)=>v===null?t('À compléter','To complete'):new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB',{maximumFractionDigits:2}).format(v);
 const units:Record<RentalUnit,string>={month:t('mois','months'),week:t('semaines','weeks'),night:t('nuits','nights'),year:t('année','year')};
 return plan.scenarios.flatMap(s=>s.periods.map((p,i)=>({
  label:`${s.name||t('Sans nom','Unnamed')} · ${t('période','period')} ${i+1}${s.id===plan.referenceId?' · '+t('Référence','Reference'):''}`,
  value:[`${fmt(p.rate)} € / ${units[p.unit]} × ${fmt(p.rentedUnits)} ${units[p.unit]} ${t('effectivement loués','actually rented')}`,p.start?`${t('Fenêtre annuelle inclusive','Inclusive annual window')} ${p.start} → ${p.end}`:t('Dans les douze mois d’exploitation','Within twelve operating months'),p.availability!==null?`${t('Disponibilité','Availability')} ${fmt(p.availability)} ${units[p.unit]}`:'',p.occupancyPercent!==null?`${t('Occupation','Occupancy')} ${fmt(p.occupancyPercent)} %`:'',i===0?`${t('Délai après travaux avant premier loyer','Delay after works before first rent')} : ${fmt(s.receiptDelayMonths)} ${t('mois','months')}`:''].filter(Boolean).join(' · ')
 })));
}
export function rentalComparisonText(plan: RentalPlan,lang:'fr'|'en'='fr') {
 const cost=commonRentalCost(plan),basis=cost===null?(lang==='fr'?'À compléter':'To complete'):new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB').format(cost)+' €';
 return [lang==='fr'?'Estimation annuelle après mise en location':'Annual estimate after letting begins',(lang==='fr'?'Coût de revient commun confirmé : ':'Confirmed common investment basis: ')+basis,...rentalComparisonRows(plan,lang).map(r=>`${r.label} : ${r.value}`),...rentalAssumptionRows(plan,lang).map(r=>`${r.label} : ${r.value}`),lang==='fr'?'Alternatives non cumulées. Résultats avant financement et fiscalité. Aucun revenu de première année après acquisition n’est présumé.':'Alternatives are not added. Before financing and tax. No first-year acquisition income is assumed.'].join('\n');
}
