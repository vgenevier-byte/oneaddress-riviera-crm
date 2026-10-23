/** Conservative extra agency facts. Every value carries an exact document excerpt. */
import type { AgencyExtraction, ExtractionEvidence, PdfPage } from "./agency";

const tidy = (value: string) => value.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
const headings = /^(?:nom du (?:projet|bien)|projet|r[ée]f[ée]rence|type de bien|adresse|ville|code postal|localisation|agence|contact|agent|conseiller|t[ée]l[ée]phone|mobile|e-?mail|prix|honoraires|surfaces?|terrain|pi[èe]ces|chambres|[ée]tat|[ée]quipements?|annexes?|ext[ée]rieur|piscine|vue|description|potentiel|travaux|diagnostics?|dpe|ges|charges|contraintes|points? d.int[ée]r[êe]t|points? [àa] v[ée]rifier)\b/i;

export function enrichAgencyFacts(base: AgencyExtraction, pages: PdfPage[]): AgencyExtraction {
  const fields = { ...base.fields }, evidence = { ...base.evidence }, warnings = [...base.warnings];
  const entries = pages.flatMap(page => page.text.split(/\r?\n/).map(text => ({ page: page.page, text: tidy(text) })).filter(line => line.text));
  const set = (key: string, value: string, page: number, excerpt: string) => {
    if (!value) return;
    fields[key] = value.slice(0, key === "description" || key === "agencyPotential" ? 12_000 : 4_000);
    evidence[key] = { page, extract: tidy(excerpt).slice(0, 230) } satisfies ExtractionEvidence;
  };
  const labelled = (key: string, label: string, multiline = false) => {
    const re = new RegExp(`^(?:${label})\\s*(?::|：|[-–]\\s)?\\s*(.*)$`, "i");
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], match = entry.text.match(re);
      if (!match) continue;
      const chunks = match[1] ? [match[1]] : [];
      for (let next = index + 1; next < entries.length && chunks.length < (multiline ? 14 : 1); next++) {
        if (entries[next].page !== entry.page || headings.test(entries[next].text)) break;
        chunks.push(entries[next].text);
      }
      if (chunks.length) { set(key, chunks.join(multiline ? "\n" : " "), entry.page, [entry.text, ...chunks].join(" ")); return; }
    }
  };
  labelled("project", "Nom du (?:projet|bien)|Titre de l.annonce");
  labelled("city", "Ville(?: du bien)?|Commune(?: du bien)?");
  labelled("postalCode", "Code postal(?: du bien)?");
  labelled("location", "Localisation(?: du bien)?|Quartier|Secteur");
  labelled("agencyName", "Agence(?: immobili[èe]re)?|Nom de l.agence");
  labelled("agencyAddress", "Adresse (?:de l.agence|agence)");
  labelled("agencyPhone", "(?:T[ée]l(?:[ée]phone)?|Mobile|Portable)(?: de l.agence| agence)");
  labelled("agencyEmail", "(?:E-?mail|Courriel)(?: de l.agence| agence)");
  labelled("agentName", "(?:Votre )?(?:Agent immobilier|Agent|Conseiller|Conseill[èe]re|N[ée]gociateur)(?: immobilier)?|Contact agent");
  labelled("agentPhone", "(?:T[ée]l(?:[ée]phone)?|Mobile|Portable)(?: de l.agent| agent| du conseiller)");
  labelled("agentEmail", "(?:E-?mail|Courriel)(?: de l.agent| agent| du conseiller)");
  labelled("condition", "[ÉE]tat(?: du bien)?");
  labelled("equipment", "[ÉE]quipements?|Prestations", true);
  labelled("annexes", "Annexes?|D[ée]pendances", true);
  labelled("exterior", "Ext[ée]rieur(?:s)?|Espaces ext[ée]rieurs", true);
  labelled("pool", "Piscine");
  labelled("view", "Vue");
  labelled("description", "Description(?: du bien)?|Descriptif(?: du bien)?", true);
  labelled("agencyPotential", "Potentiel(?: annonc[ée])?(?: par l.agence)?|Possibilit[ée]s? annonc[ée]es?", true);
  labelled("renovation", "R[ée]novation(?: annonc[ée]e)?|Travaux(?: envisag[ée]s| annonc[ée]s)?", true);
  labelled("division", "Division(?: annonc[ée]e)?", true);
  labelled("extension", "(?:Agrandissement|Extension)(?: annonc[ée]e)?", true);
  labelled("resale", "Revente(?: annonc[ée]e)?", true);
  labelled("rental", "Location(?: annonc[ée]e)?|Potentiel locatif", true);
  labelled("pointsOfInterest", "Points? d.int[ée]r[êe]t|Atouts", true);
  labelled("pointsToVerify", "Points? [àa] (?:v[ée]rifier|confirmer)|R[ée]serves", true);
  labelled("diagnostics", "Diagnostics?", true);
  labelled("charges", "Charges(?: de copropri[ée]t[ée]| annuelles| mensuelles)?", true);
  labelled("constraints", "Contraintes|Servitudes|R[èe]gles d.urbanisme", true);
  const textualFields: [string, RegExp][] = [
    ["rooms", /\b(?:Nombre (?:de )?pi[èe]ces|Pi[èe]ces)\s*:?\s*(\d{1,2})\b/i],
    ["bedrooms", /\b(?:Nombre de chambres|Chambres)\s*:?\s*(\d{1,2})\b/i],
  ];
  for (const [key, re] of textualFields) if (!fields[key]) for (const entry of entries) { const match = entry.text.match(re); if (match) { set(key, match[1], entry.page, match[0]); break; } }
  for (const entry of entries) {
    if (/^Honoraires\b|^Frais d.agence\b/i.test(entry.text)) set("fees", entry.text, entry.page, entry.text);
    if (/^(?:DPE|GES|Classe [ée]nergie|[ÉE]nergie|Performance [ée]nerg[ée]tique|Consommation [ée]nerg[ée]tique)\b/i.test(entry.text)) {
      fields.diagnostics = [fields.diagnostics, entry.text].filter(Boolean).join("\n");
      evidence.diagnostics ??= { page: entry.page, extract: entry.text.slice(0, 230) };
    }
    if (!fields.areaKind && /^Surface\b/i.test(entry.text) && /m\s*[²2]/i.test(entry.text)) set("areaKind", entry.text.match(/^Surface\s*(habitable|(?:Loi )?Carrez|utile|totale)/i)?.[0] || "Surface annoncée — nature à confirmer", entry.page, entry.text);
  }
  // An unlabelled agency footer may contain an address. Never promote it to the property address.
  for (const key of ["city", "postalCode"]) if (fields[key]) fields[key] = fields[key].replace(/\s*[;|].*$/, "").trim();
  if (fields.postalCode && !/^\d{5}$/.test(fields.postalCode)) { delete fields.postalCode; delete evidence.postalCode; warnings.push("Code postal ambigu : laissé vide pour confirmation."); }
  if (fields.address && !/adresse exacte [àa] confirmer/i.test(fields.address)) {
    const postalCity = fields.address.match(/\b(\d{5})\s+(.+)$/);
    if (postalCity) { if (!fields.postalCode) set("postalCode", postalCity[1], evidence.address?.page ?? 1, evidence.address?.extract ?? fields.address); if (!fields.city) set("city", postalCity[2], evidence.address?.page ?? 1, evidence.address?.extract ?? fields.address); }
  }
  for (const key of ["agencyPhone", "agentPhone"]) if (fields[key]) {
    const phone = fields[key].match(/(?:\+\d{1,3}[ .-]?)?(?:\(?\d\)?[ .-]?){8,13}/);
    if (phone) fields[key] = phone[0].trim(); else { delete fields[key]; delete evidence[key]; warnings.push("Un numéro de téléphone n’a pas été reconnu : vérifier le document."); }
  }
  for (const key of ["agencyEmail", "agentEmail"]) if (fields[key]) {
    const email = fields[key].match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/i);
    if (email) fields[key] = email[0]; else { delete fields[key]; delete evidence[key]; warnings.push("Une adresse e-mail n’a pas été reconnue : vérifier le document."); }
  }
  if (!fields.agencyName && base.agency !== "Agence à confirmer") fields.agencyName = base.agency;
  const agency = fields.agencyName || base.agency;
  if (fields.source && agency !== base.agency) fields.source = fields.source.replace(base.agency, agency).slice(0, 210);
  // Remove the legacy text-only warning: the reader now attempts local OCR before returning.
  const readerWarnings = warnings.filter(message => !message.includes("Aucun OCR n’est intégré"));
  if (pages.every(page => tidy(page.text).length < 30)) readerWarnings.unshift("Texte non exploitable après lecture : compléter manuellement les champs manquants.");
  if (["agencyPotential", "renovation", "division", "extension", "resale", "rental"].some(key => fields[key])) readerWarnings.push("Potentiel annoncé par l’agence : faisabilité, autorisations et montants à confirmer. Aucune hypothèse personnelle n’est créée.");
  return { ...base, agency, fields, evidence, warnings: [...new Set(readerWarnings)] };
}
