/**
 * Run with: AGENT_BROWSER_BIN=/path/to/agent-browser tsx tests/contactAddress.browser.ts
 * Copies the app to a temporary directory, replaces only its Supabase adapter,
 * and tests the real CRM UI using next build/start. No credentials or .env files are copied.
 * Optional CONTACT_ADDRESS_ARTIFACTS controls the screenshot/report directory.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fictionalAccount, fictionalContact, fictionalIban, fictionalInvoice } from "./fixtures/vendorBanking";

async function main() {
  const root = process.cwd();
  const preview = mkdtempSync(join(tmpdir(), "oar-postal-browser-"));
  const artifacts = resolve(process.env.CONTACT_ADDRESS_ARTIFACTS || join(preview, "artifacts"));
  mkdirSync(artifacts, { recursive: true });
  for (const directory of ["app", "components", "lib", "public"]) cpSync(join(root, directory), join(preview, directory), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", "next-env.d.ts", "next.config.js", "next.config.mjs"]) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(preview, file));
  }
  symlinkSync(join(root, "node_modules"), join(preview, "node_modules"), "dir");
  writeFileSync(join(preview, "lib/supabase.ts"), `
import type { supabase as RealClient } from ${JSON.stringify(join(root, "lib/supabase"))};
(globalThis as any).__postalFixture = true;
const user = { id: "fixture-user", email: "fixture@example.invalid" };
const adapter = {
 auth: {
  getUser: async () => ({ data: { user }, error: null }),
  getSession: async () => ({ data: { session: { user } }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({ error: null })
 },
 from: (table: string) => {
  if (table !== "crm_workspace_state") throw new Error("Unexpected fixture table: " + table);
  const query = {
   select: () => query, eq: () => query,
   single: async () => ({ data: { payload: JSON.parse(localStorage.getItem("fixture-shared") || "{}"), updated_at: "2026-09-15T10:00:00Z" }, error: null }),
   upsert: async (value: { payload: unknown }) => { localStorage.setItem("fixture-shared", JSON.stringify(value.payload)); return { error: null }; }
  }; return query;
 }
};
export const supabase = adapter as unknown as typeof RealClient;
`);
  // Match production routing. Next 14 dev reports duplicate app/public metadata
  // icons as HTTP 500; keep both files and verify their production responses.
  const nextBinary = join(root, "node_modules/next/dist/bin/next");
  const buildLog = execFileSync(process.execPath, [nextBinary, "build"], { cwd: preview, encoding: "utf8", timeout: 180000 });
  writeFileSync(join(artifacts, "fixture-build.log"), buildLog);
  const port = Number(process.env.CONTACT_ADDRESS_PORT || 3148);
  const server = spawn(process.execPath, [nextBinary, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: preview, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", chunk => { serverLog += chunk; });
  server.stderr.on("data", chunk => { serverLog += chunk; });
  const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
  const session = `postal-test-${process.pid}`;
  const ab = (...args: string[]) => execFileSync(binary, ["--session", session, ...args], { encoding: "utf8", timeout: 45000 }).trim();
  const evaluate = (code: string) => JSON.parse(ab("eval", code));
  const waitUntil = async (code: string) => {
    for (let i = 0; i < 100; i++) { if (evaluate(code)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`Timed out: ${code}`);
  };
  const capture = (name: string) => ab("screenshot", join(artifacts, `${name}.png`));
  const state = () => evaluate('JSON.parse(localStorage.getItem("oneaddress-riviera-crm-v1"))');
  const report: string[] = [];
  const pass = (message: string) => { report.push(message); console.log(`PASS ${message}`); };
  const checkOverflow = (scope = "body") => {
    const measures = evaluate(`(() => { const el = document.querySelector(${JSON.stringify(scope)}); return { viewport: innerWidth, page: document.documentElement.scrollWidth, width: el.clientWidth, content: el.scrollWidth }; })()`);
    assert.ok(measures.page <= measures.viewport, JSON.stringify(measures));
    assert.ok(measures.content <= measures.width + 1, JSON.stringify(measures));
  };
  const address = "12 avenue Exemple\nBâtiment B\n06400 Cannes\nFrance";
  const foreign = "7 Fictional Straße, chez l’amie Élodie\nWohnung B — 東京\nSW1A 0ZZ London\nUnited Kingdom";
  const fixture = { contacts: [
    { ...fictionalContact, name: "Contact Démonstration", postalAddress: address, supplierCategory: "Entretien", supplierZone: "Zone fictive conservée", budget: 1234, preferences: "Préférences historiques", importantNotes: "Notes historiques", unknownProperty: { quoteId: "quote-test" } },
    { id: "legacy-test", name: "Ancien Fictif", kind: "Client", email: "", phone: "", city: "Zone test", budget: 0, source: "Test", notes: "", createdAt: "2026-09-15" }
  ], vendorInvoices: [fictionalInvoice] };
  const selectContact = (name: string, action: "details" | "edit") => {
    const index = evaluate(`Array.from(document.querySelectorAll('.oar-contact-row')).findIndex(e => e.querySelector('h3').textContent === ${JSON.stringify(name)})`);
    assert.ok(index >= 0, name);
    // Keyboard activation avoids a sticky mobile toolbar covering the row while
    // the browser scrolls it into view after a long modal has been closed.
    ab("focus", `.oar-contact-row:nth-child(${index + 1}) button:nth-of-type(${action === "details" ? 2 : 3})`);
    ab("press", "Enter");
    ab("wait", action === "details" ? "#contact-detail-panel" : "#contact-edit-panel");
  };
  const closeDetails = () => ab("click", "#contact-detail-panel .confirm-actions button:first-child");
  const addressText = () => evaluate('document.querySelector("#contact-detail-panel [class*=address__]").textContent');
  const copyButton = '#contact-detail-panel [class*=details__] button';
  try {
    for (let i = 0; !serverLog.includes("Ready"); i++) {
      if (i > 150 || server.exitCode !== null) throw new Error(serverLog);
      await new Promise(r => setTimeout(r, 100));
    }
    ab("open", `http://127.0.0.1:${port}`);
    ab("network", "route", "https://*", "--abort");
    ab("network", "route", "**/api/**", "--abort");
    assert.equal(evaluate("globalThis.__postalFixture === true"), true);
    ab("snapshot", "-i");
    assert.equal(ab("errors"), "");
    const iconResults = [];
    for (const path of ["/favicon.ico", "/icon.png", "/icon.png?9fd7c2bf72f2e08d"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const bytes = (await response.arrayBuffer()).byteLength;
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get("content-type")?.startsWith("image/"), path);
      assert.ok(bytes > 0, path);
      iconResults.push({ path, status: response.status, bytes });
    }
    writeFileSync(join(artifacts, "fixture-icons.json"), JSON.stringify(iconResults, null, 2));
    capture("initial-check");
    pass("aperçu isolé de production : page chargée, icônes HTTP 200, aucune erreur JavaScript, aucun service externe");
    evaluate(`localStorage.setItem('fixture-shared', ${JSON.stringify(JSON.stringify(fixture))}); localStorage.setItem('oneaddress-riviera-crm-v1', ${JSON.stringify(JSON.stringify(fixture))}); true`);
    ab("reload");
    await waitUntil('document.body.textContent.includes("Base partagée chargée") || document.body.textContent.includes("Base partagée synchronisée")');
    ab("set", "viewport", "1440", "1000");
    ab("click", ".nav-list button:nth-child(2)");
    await waitUntil('document.querySelectorAll(".oar-contact-row").length === 2');
    const initial = state();
    ab("fill", '.contact-create-form [name="postalAddress"]', address);
    for (const kind of ["Client", "Prestataire", "Propriétaire", "Client"]) {
      ab("select", '.contact-create-form [name="kind"]', kind);
      assert.equal(evaluate('document.querySelector(".contact-create-form [name=postalAddress]").value'), address);
      assert.equal(evaluate('document.querySelector(".contact-create-form [name=postalAddress]").required'), false);
    }
    checkOverflow(); capture("create-1440");
    pass("création : adresse facultative, visible et conservée pendant les changements des trois types");
    selectContact("Contact Démonstration", "edit");
    assert.equal(evaluate('document.querySelector(".contact-edit-form [name=postalAddress]").value'), address);
    for (const kind of ["Client", "Propriétaire", "Prestataire"]) {
      ab("select", '.contact-edit-form [name="kind"]', kind);
      assert.equal(evaluate('document.querySelector(".contact-edit-form [name=postalAddress]").value'), address);
    }
    // Reopen so this verification changes only the address.
    ab("click", "#contact-edit-panel .confirm-actions button:first-child");
    selectContact("Contact Démonstration", "edit");
    checkOverflow("#contact-edit-panel"); capture("edit-1440");
    ab("fill", '.contact-edit-form [name="postalAddress"]', foreign);
    ab("click", '#contact-edit-panel button[type="submit"]');
    await waitUntil('document.querySelector("#contact-detail-panel") !== null');
    assert.equal(addressText(), foreign);
    assert.equal(evaluate('getComputedStyle(document.querySelector("#contact-detail-panel [class*=address__]")).whiteSpace'), "pre-wrap");
    const changed = state();
    const originalContact = initial.contacts.find((c: { id: string }) => c.id === "vendor-test");
    const changedContact = changed.contacts.find((c: { id: string }) => c.id === "vendor-test");
    const { updatedAt, updatedBy, ...unchanged } = changedContact;
    assert.deepEqual(unchanged, { ...originalContact, postalAddress: foreign });
    assert.ok(updatedAt && updatedBy);
    assert.deepEqual(changed.vendorInvoices, initial.vendorInvoices);
    pass("modification : adresse étrangère, accents et sauts de ligne ; tous les autres champs/RIB/liens intacts ; traçabilité présente");
    checkOverflow("#contact-detail-panel");
    ab("scrollintoview", copyButton); capture("details-1440");
    closeDetails(); selectContact("Contact Démonstration", "details");
    assert.equal(addressText(), foreign);
    pass("réouverture de la fiche : adresse conservée");
    // Observe the exact argument and await the native write; reading the OS clipboard
    // is separately permission-gated in the headless browser.
    evaluate('globalThis.__nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { globalThis.__nativeCopy = text; await globalThis.__nativeWrite(text); } } }); true');
    ab("click", copyButton);
    await waitUntil('document.querySelector("#contact-detail-panel [role=status]").textContent === "Adresse copiée"');
    assert.equal(evaluate("globalThis.__nativeCopy"), foreign);
    pass("presse-papiers natif : writeText résolu avec le texte exact, accents et retours à la ligne");
    evaluate('globalThis.__originalClipboard = navigator.clipboard; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: text => { globalThis.__copied = text; return new Promise(resolve => { globalThis.__resolveCopy = resolve; }); } } }); true');
    ab("click", copyButton);
    assert.equal(evaluate('document.querySelector("#contact-detail-panel [role=status]").textContent'), "");
    assert.equal(evaluate("globalThis.__copied"), foreign);
    evaluate("globalThis.__resolveCopy(); true");
    await waitUntil('document.querySelector("#contact-detail-panel [role=status]").textContent === "Adresse copiée"');
    evaluate('Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Denied for fixture"); } } }); true');
    ab("click", copyButton);
    await waitUntil('document.querySelector("#contact-detail-panel textarea[readonly]") !== null');
    assert.equal(evaluate('document.querySelector("#contact-detail-panel textarea[readonly]").value'), foreign);
    assert.match(evaluate('document.querySelector("#contact-detail-panel [role=status]").textContent'), /Copie impossible/);
    ab("focus", '#contact-detail-panel textarea[readonly]');
    assert.equal(evaluate('document.activeElement.selectionEnd - document.activeElement.selectionStart'), foreign.length);
    capture("copy-failure-1440");
    evaluate('Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); true');
    ab("click", copyButton);
    assert.match(evaluate('document.querySelector("#contact-detail-panel [role=status]").textContent'), /Copie impossible/);
    pass("copie : aucune fausse confirmation, refus et API absente donnent un texte sélectionnable");
    closeDetails();
    for (const query of ["Fictional Straße", "SW1A 0ZZ"]) {
      ab("fill", 'input[type="search"]', query);
      await waitUntil('document.querySelectorAll(".oar-contact-row").length === 1');
      assert.equal(evaluate('document.querySelector(".oar-contact-row h3").textContent'), "Contact Démonstration");
    }
    evaluate('document.querySelector("input[type=search]").focus(); document.querySelector("input[type=search]").select(); true');
    ab("press", "Backspace");
    await waitUntil('document.querySelectorAll(".oar-contact-row").length === 2');
    assert.equal(evaluate('document.querySelector(".oar-contact-row").textContent.includes("Fictional Straße")'), false);
    pass("recherche par rue/code postal ; cartes toujours compactes avec Ville / zone");
    selectContact("Ancien Fictif", "details");
    assert.equal(addressText(), "Non renseignée");
    assert.equal(evaluate(`document.querySelector(${JSON.stringify(copyButton)})`), null);
    closeDetails();
    pass("ancien contact sans postalAddress : Non renseignée, bouton absent");
    for (const kind of ["Client", "Prestataire", "Propriétaire"]) {
      ab("select", '.contact-create-form [name="kind"]', kind);
      ab("fill", '.contact-create-form [name="name"]', `Création fictive ${kind}`);
      ab("fill", '.contact-create-form [name="postalAddress"]', address);
      ab("focus", '.contact-create-form button[type="submit"]');
      ab("press", "Enter");
      await waitUntil(`JSON.parse(localStorage.getItem("oneaddress-riviera-crm-v1")).contacts.some(c => c.name === ${JSON.stringify(`Création fictive ${kind}`)})`);
      assert.equal(state().contacts.find((c: { name: string }) => c.name === `Création fictive ${kind}`).postalAddress, address);
    }
    ab("fill", '.contact-create-form [name="name"]', "Sans Adresse Fictif");
    ab("focus", '.contact-create-form button[type="submit"]');
    ab("press", "Enter");
    await waitUntil('JSON.parse(localStorage.getItem("oneaddress-riviera-crm-v1")).contacts.some(c => c.name === "Sans Adresse Fictif")');
    assert.equal(state().contacts.find((c: { name: string }) => c.name === "Sans Adresse Fictif").postalAddress, "");
    pass("créations via les formulaires : les trois types avec adresse, création sans adresse");
    selectContact("Contact Démonstration", "edit");
    evaluate('document.querySelector(".contact-edit-form [name=postalAddress]").focus(); document.querySelector(".contact-edit-form [name=postalAddress]").select(); true');
    ab("press", "Backspace");
    ab("click", '#contact-edit-panel button[type="submit"]');
    await waitUntil('document.querySelector("#contact-detail-panel") !== null');
    assert.equal(addressText(), "Non renseignée");
    assert.equal(state().contacts.find((c: { id: string }) => c.id === "vendor-test").postalAddress, "");
    closeDetails();
    pass("effacement volontaire sauvegardé");
    const longAddress = `${foreign}\n${"AdresseTrèsLongueSansEspace".repeat(16)}\n<img src=x onerror=alert(1)>`;
    selectContact("Contact Démonstration", "edit");
    ab("fill", '.contact-edit-form [name="postalAddress"]', longAddress);
    ab("click", '#contact-edit-panel button[type="submit"]');
    await waitUntil('document.querySelector("#contact-detail-panel") !== null');
    assert.equal(addressText(), longAddress);
    assert.equal(evaluate('document.querySelector("#contact-detail-panel [class*=details__] img")'), null);
    checkOverflow("#contact-detail-panel");
    ab("scrollintoview", copyButton); capture("long-address-1440");
    ab("set", "viewport", "390", "844");
    checkOverflow("#contact-detail-panel");
    ab("scrollintoview", '#contact-detail-panel [class*=address__]'); capture("long-address-390");
    closeDetails();
    selectContact("Contact Démonstration", "edit");
    ab("fill", '.contact-edit-form [name="postalAddress"]', address);
    ab("scrollintoview", '.contact-edit-form [name="postalAddress"]');
    checkOverflow("#contact-edit-panel"); capture("edit-390");
    ab("click", '#contact-edit-panel button[type="submit"]');
    ab("scrollintoview", copyButton); checkOverflow("#contact-detail-panel"); capture("details-390");
    closeDetails();
    ab("fill", '.contact-create-form [name="postalAddress"]', address);
    ab("scrollintoview", '.contact-create-form [name="postalAddress"]');
    checkOverflow(); capture("create-390");
    pass("1440/390 px : création, modification, détails, adresse longue sans débordement ; HTML affiché comme texte");
    await waitUntil(`JSON.parse(localStorage.getItem('fixture-shared')).contacts.find(c => c.id === 'vendor-test').postalAddress === ${JSON.stringify(address)}`);
    ab("reload");
    await waitUntil('document.body.textContent.includes("Base partagée chargée") || document.body.textContent.includes("Base partagée synchronisée")');
    assert.equal(state().contacts.find((c: { id: string }) => c.id === "vendor-test").postalAddress, address);
    assert.equal(ab("errors"), "");
    pass("rechargement complet : sauvegarde fictive habituelle conservée, aucune erreur navigateur");
    // Each conversion starts from a categorized supplier and uses the real saved
    // form flow. All state stays inside the isolated localStorage adapter above.
    const conversionContact = {
      ...fixture.contacts[0], companyName: fictionalContact.companyName,
      civility: "MME", firstName: "Élodie", name: "Conversion Fictive",
      email: "conversion@example.invalid", phone: "+33 0 00 00 00 00",
      source: "Dossier historique fictif", relationshipStatus: "Prestataire",
      supplierContactName: "Référente historique", supplierQuality: "Premium",
      supplierReliability: "Fiable", supplierStatus: "Actif",
      supplierPriceNotes: "Prix historique conservé", supplierCommissionNotes: "Commission historique conservée",
      supplierBankAccounts: [
        { ...fictionalAccount, driveFolderId: "fictional-folder", driveOriginalFileName: "Original_fictif.pdf", driveWebViewLink: "https://drive.google.com/file/d/fictional-rib-file/view", driveMimeType: "application/pdf", driveSize: 123, driveUploadedAt: "2026-09-11T09:30:00Z" },
        { ...fictionalAccount, id: "bank-test-2", iban: fictionalIban("02"), label: "Second compte fictif", isPrimary: false, driveFileId: "fictional-rib-file-2", driveFileName: "SECOND_RIB_FICTIF.pdf" }
      ]
    };
    const conversionFixture = {
      ...fixture, contacts: [conversionContact, fixture.contacts[1]],
      vendorQuotes: [{ id: "quote-history-test", contactId: conversionContact.id, contactName: conversionContact.companyName, category: "Entretien", title: "Devis historique fictif", quoteReference: "DEVIS-TEST-001", quoteDate: "2026-09-10", validUntil: "2026-09-30", amount: 268, status: "Validé", linkedInvoiceId: fictionalInvoice.id, createdAt: "2026-09-10" }],
      vendorInvoices: [{ ...fictionalInvoice, paidAmount: 100, status: "Partiellement payé", paymentMethod: "Virement fictif", paymentBankAccountId: fictionalAccount.id, sourceQuoteId: "quote-history-test", sourceQuoteReference: "DEVIS-TEST-001", linkedDocumentId: "document-history-test", invoiceDocumentName: "FACTURE_FICTIVE.pdf" }],
      documents: [{ id: "document-history-test", name: "FACTURE_FICTIVE.pdf", contactId: conversionContact.id, vendorInvoiceId: fictionalInvoice.id }]
    };
    const conversionName = "MME Élodie Conversion Fictive";
    const filterNames = ["Tous", "Clients", "Prestataires", "Propriétaires"];
    const setFilter = (name: string) => {
      ab("focus", `.contact-filter-row button:nth-child(${filterNames.indexOf(name) + 1})`);
      ab("press", "Enter");
    };
    const conversionVisible = () => evaluate(`Array.from(document.querySelectorAll('.oar-contact-row h3')).some(e => e.textContent === ${JSON.stringify(conversionName)})`);
    const detailType = () => evaluate('Array.from(document.querySelectorAll("#contact-detail-panel .contact-detail-grid > div")).find(e => e.querySelector("span")?.textContent === "Type").querySelector("strong").textContent');
    const conversionEvidence = [];
    for (const width of [1440, 390]) {
      for (const kind of ["Client", "Propriétaire"]) {
        const slug = kind === "Client" ? "client" : "proprietaire";
        evaluate(`localStorage.clear(); localStorage.setItem('fixture-shared', ${JSON.stringify(JSON.stringify(conversionFixture))}); localStorage.setItem('oneaddress-riviera-crm-v1', ${JSON.stringify(JSON.stringify(conversionFixture))}); true`);
        ab("reload");
        await waitUntil('document.body.textContent.includes("Base partagée chargée") || document.body.textContent.includes("Base partagée synchronisée")');
        ab("set", "viewport", String(width), width === 1440 ? "1000" : "844");
        ab("click", width === 1440 ? ".nav-list button:nth-child(2)" : 'nav[aria-label="Navigation mobile principale"] button:nth-child(2)');
        await waitUntil('document.querySelectorAll(".oar-contact-row").length === 2');
        const before = state();
        const beforeContact = before.contacts.find((c: { id: string }) => c.id === conversionContact.id);
        assert.equal(beforeContact.kind, "Prestataire");
        assert.equal(beforeContact.supplierCategory, "Entretien");
        setFilter("Prestataires");
        assert.equal(conversionVisible(), true);
        setFilter("Clients");
        assert.equal(conversionVisible(), false);
        setFilter("Propriétaires");
        assert.equal(conversionVisible(), false);
        setFilter("Tous");
        selectContact(conversionName, "edit");
        ab("select", '.contact-edit-form [name="kind"]', kind);
        assert.equal(evaluate('document.querySelector(".contact-edit-form [name=postalAddress]").value'), address);
        checkOverflow("#contact-edit-panel");
        ab("click", '#contact-edit-panel button[type="submit"]');
        await waitUntil('document.querySelector("#contact-detail-panel") !== null');
        assert.equal(detailType(), kind);
        assert.equal(addressText(), address);
        const assertPreserved = () => {
          const saved = state();
          const savedContact = saved.contacts.find((c: { id: string }) => c.id === conversionContact.id);
          const { updatedAt, updatedBy, ...fields } = savedContact;
          const { updatedAt: beforeUpdatedAt, updatedBy: beforeUpdatedBy, ...beforeFields } = beforeContact;
          assert.deepEqual(fields, { ...beforeFields, kind, supplierCategory: "", relationshipStatus: "Prospect" });
          assert.ok(updatedAt && updatedBy);
          assert.deepEqual(savedContact.supplierBankAccounts, beforeContact.supplierBankAccounts);
          assert.equal(savedContact.supplierBankAccounts[0].status, "Vérifié");
          assert.equal(savedContact.supplierBankAccounts[0].isPrimary, true);
          const { contacts: savedContacts, ...savedHistory } = saved;
          const { contacts: beforeContacts, ...beforeHistory } = before;
          assert.deepEqual(savedContacts.filter((c: { id: string }) => c.id !== conversionContact.id), beforeContacts.filter((c: { id: string }) => c.id !== conversionContact.id));
          assert.deepEqual(savedHistory, beforeHistory);
        };
        assertPreserved();
        closeDetails();
        // Wait for the normal shared-save path, then prove the persisted type after
        // a complete page reload and by reopening both details and edit.
        await waitUntil(`JSON.parse(localStorage.getItem('fixture-shared')).contacts.find(c => c.id === ${JSON.stringify(conversionContact.id)}).kind === ${JSON.stringify(kind)}`);
        ab("reload");
        await waitUntil('document.body.textContent.includes("Base partagée chargée") || document.body.textContent.includes("Base partagée synchronisée")');
        ab("click", width === 1440 ? ".nav-list button:nth-child(2)" : 'nav[aria-label="Navigation mobile principale"] button:nth-child(2)');
        await waitUntil('document.querySelectorAll(".oar-contact-row").length === 2');
        selectContact(conversionName, "details");
        assert.equal(detailType(), kind);
        assert.equal(addressText(), address);
        evaluate('globalThis.__nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { globalThis.__nativeCopy = text; await globalThis.__nativeWrite(text); } } }); true');
        ab("focus", copyButton); ab("press", "Enter");
        await waitUntil('document.querySelector("#contact-detail-panel [role=status]").textContent === "Adresse copiée"');
        assert.equal(evaluate("globalThis.__nativeCopy"), address);
        checkOverflow("#contact-detail-panel");
        ab("scrollintoview", '#contact-detail-panel [class*=address__]');
        capture(`conversion-${slug}-details-${width}`);
        closeDetails();
        selectContact(conversionName, "edit");
        assert.equal(evaluate('document.querySelector(".contact-edit-form [name=kind]").value'), kind);
        assert.equal(evaluate('document.querySelector(".contact-edit-form [name=postalAddress]").value'), address);
        checkOverflow("#contact-edit-panel");
        ab("scrollintoview", '.contact-edit-form [name="postalAddress"]');
        capture(`conversion-${slug}-edit-${width}`);
        ab("click", "#contact-edit-panel .confirm-actions button:first-child");
        const filters: Record<string, boolean> = {};
        for (const filter of ["Clients", "Prestataires", "Propriétaires"]) {
          setFilter(filter);
          filters[filter] = conversionVisible();
          assert.equal(filters[filter], filter === (kind === "Client" ? "Clients" : "Propriétaires"), `${kind}: ${filter}`);
          checkOverflow();
          capture(`conversion-${slug}-filter-${filter === "Clients" ? "clients" : filter === "Prestataires" ? "prestataires" : "proprietaires"}-${width}`);
        }
        setFilter("Tous");
        assertPreserved();
        assert.equal(ab("errors"), "");
        conversionEvidence.push({ from: "Prestataire", to: kind, width, filters, reloaded: true, supplierCategory: "", relationshipStatus: "Prospect", bankAccountsAndDocumentsUnchanged: true, otherContactFieldsAndHistoryUnchanged: true, horizontalOverflow: false });
        pass(`conversion sauvegardée Prestataire → ${kind} à ${width} px : rechargement, fiche/formulaire et 3 filtres conformes ; adresse, identité, notes, supplierZone, deux RIB/documents Vérifié/Principal et historiques devis/facture/paiement intacts ; aucun débordement`);
      }
    }
    writeFileSync(join(artifacts, "conversion-browser-evidence.json"), JSON.stringify(conversionEvidence, null, 2));
    writeFileSync(join(artifacts, "browser-results.json"), JSON.stringify({ passed: report.length, checks: report, preview }, null, 2));
    console.log(`Artifacts: ${artifacts}`);
  } catch (error) {
    capture("failure");
    writeFileSync(join(artifacts, "failure-state.txt"), ab("snapshot", "-i") + "\n" + ab("eval", '({inputs: Array.from(document.querySelectorAll("input")).map(e=>({name:e.name,value:e.value})), state: localStorage.getItem("oneaddress-riviera-crm-v1")})'));
    throw error;
  } finally {
    writeFileSync(join(artifacts, "preview-server.log"), serverLog);
    try { ab("close"); } finally { server.kill("SIGTERM"); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
