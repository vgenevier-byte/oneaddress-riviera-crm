/** Explicit project-only sections stay in the ephemeral extraction report for
 * human review, and are excluded from public property/financial parsing. */
export const ownerContextHeading = /^(?:propri[ée]taires?\b|owner(?:s|ship)?\b|organisation de la propri[ée]t[ée]|droits d[ée]tenus|nombre de propri[ée]taires|accord sur la vente|motif (?:de vente|communiqu[ée])|date de mise en vente|[ée]ch[ée]ance (?:vendeur|souhait[ée]e)|baisses? de prix|position (?:communiqu[ée]e )?sur le prix|points restant [àa] [ée]claircir|[âa]ge du propri[ée]taire|nationalit[ée]s? du propri[ée]taire|pays de r[ée]sidence du propri[ée]taire|notre appr[ée]ciation|potentiel estim[ée]|justification interne|points favorables|points de blocage|prochaine question|reported owners|agreement to sell|sale reason|disclosed sale reason|declared owner count|listing date|seller deadline|reported price reductions|disclosed price position|outstanding questions|negotiation assessment|negotiation potential|internal justification)\b/i;
// A private section ends only at an explicit, recognised public property label.
// Requiring its delimiter avoids treating narrative continuation text as a label.
const publicHeading = /^(?:nom du (?:projet|bien)|titre de l.annonce|projet|r[ée]f[ée]rence(?: agence)?|type de bien|typologie(?: du bien)?|adresse(?: du bien| du logement| exacte| de l.agence| agence)?|ville(?: du bien)?|commune(?: du bien)?|code postal(?: du bien)?|localisation(?: du bien)?|quartier|secteur|agence(?: immobili[èe]re)?|nom de l.agence|agent(?: immobilier)?|conseiller(?: immobilier)?|contact agent|t[ée]l[ée]phone(?: agence| de l.agence| agent| de l.agent)?|e-?mail(?: agence| de l.agence| agent| de l.agent)?|prix(?: affich[ée]| demand[ée]| de vente)?|honoraires|frais d.agence|surface(?: habitable| totale| du bien| loi carrez| carrez| utile| plancher)?|terrain|pi[èe]ces|nombre de pi[èe]ces|chambres|[ée]tat(?: du bien)?|[ée]quipements?|prestations|annexes?|d[ée]pendances|ext[ée]rieurs?|espaces ext[ée]rieurs|piscine|vue|description(?: du bien)?|descriptif(?: du bien)?|potentiel(?: annonc[ée])?(?: par l.agence)?|travaux(?: envisag[ée]s| annonc[ée]s)?|r[ée]novation(?: annonc[ée]e)?|division(?: annonc[ée]e)?|extension(?: annonc[ée]e)?|agrandissement(?: annonc[ée]e)?|revente(?: annonc[ée]e)?|location(?: annonc[ée]e)?|potentiel locatif|diagnostics?|dpe|ges|charges(?: de copropri[ée]t[ée]| annuelles| mensuelles)?|contraintes|servitudes|points? d.int[ée]r[êe]t|atouts|points? [àa] v[ée]rifier|r[ée]serves)\s*(?::|：|[-–]\s|$)/i;
export function publicAgencyText(text: string): string {
  let privateSection = false;
  return text.split(/\r?\n/).filter(line => {
    const trimmed = line.trim();
    if (ownerContextHeading.test(trimmed)) { privateSection = true; return false; }
    if (privateSection && publicHeading.test(trimmed)) privateSection = false;
    return !privateSection;
  }).join("\n");
}
