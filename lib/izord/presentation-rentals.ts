import { presentationRentalPlan } from "./rental-model";
import type JSZip from "jszip";
import type { ImportMeta, ProjectData } from "./model";
import { commonRentalCost, rentalComparisonRows, rentalAssumptionRows, rentalComparisonText } from "../fonciere/rentals";
import { appendCalendarSlide, type Calendar } from "./presentation-calendar";
export function presentationRentals(meta: ImportMeta | null | undefined, lang: "fr" | "en" = "fr") {
 const plan=presentationRentalPlan(meta,true);if(!plan)return null;
 return {plan,rows:rentalComparisonRows(plan,lang),assumptions:rentalAssumptionRows(plan,lang),text:rentalComparisonText(plan,lang),cost:commonRentalCost(plan)};
}
export async function appendRentalSlides(zip: JSZip,data:ProjectData) { const report=presentationRentals(data.importMeta);if(!report)return;
 const rows=report.rows.length?report.rows:[{label:'Scénarios',value:'À compléter'}];
 for(let i=0;i<rows.length;i+=3){const page:Calendar={layout:'rentals',title:'Estimation annuelle après mise en location',rows:rows.slice(i,i+3),text:report.text,rule:`Coût de revient commun confirmé : ${report.cost===null?'À compléter':report.cost.toLocaleString('fr-FR')+' €'}. Alternatives non cumulées. Avant financement et fiscalité. Le calendrier des travaux et du premier loyer reste distinct.`};await appendCalendarSlide(zip,data,page);}
 for(let i=0;i<report.assumptions.length;i+=3)await appendCalendarSlide(zip,data,{layout:'rentals',title:'Hypothèses locatives — unités et périodes',rows:report.assumptions.slice(i,i+3),text:report.text,rule:'Douze mois d’exploitation ; année type de 365 jours. Fenêtres inclusives, sans chevauchement. Les unités louées sont la base du revenu : aucun taux d’occupation appliqué une seconde fois. Le portage après acquisition reste distinct.'});
}
