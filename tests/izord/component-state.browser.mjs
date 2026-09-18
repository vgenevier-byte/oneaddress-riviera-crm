/** Real React/Next component checks in a disposable, credential-free fixture.
 * Production components and the committed-value hook are copied unchanged.
 * The test-only page supplies fictional props and controlled Suspense promises.
 * Run: AGENT_BROWSER_BIN=/path/to/agent-browser node tests/izord/component-state.browser.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const repo = process.cwd();
const startedAt = new Date().toISOString();
const includeCRMViews = process.argv.includes('--crm-views');
const fixture = mkdtempSync(join(tmpdir(), 'izord-component-state-'));
const artifacts = resolve(process.env.IZORD_COMPONENT_ARTIFACTS || join(fixture, 'artifacts'));
mkdirSync(artifacts, { recursive: true });
const sourceFiles = [
  'components/MobileCRMHeader.tsx', 'components/MobileMoreMenu.tsx', 'components/crmNavigation.ts',
  'components/SearchableBusinessContactPicker.tsx', 'lib/vendorContacts.ts', 'lib/types.ts',
  'lib/access/useCommittedValue.ts', 'public/oar-logo-paysage-crm.png', 'package.json', 'tsconfig.json'
];
const hashes = sourceFiles.map(path => {
  mkdirSync(dirname(join(fixture, path)), { recursive: true });
  cpSync(join(repo, path), join(fixture, path));
  return { path, sha256: createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex') };
});
if (includeCRMViews) {
  for (const folder of ['components', 'lib']) cpSync(join(repo, folder), join(fixture, folder), {
    recursive: true, filter: source => !basename(source).startsWith('.env') && !basename(source).includes('.before-')
  });
  for (const path of ['components/CRMApp.tsx', 'lib/taskMaintenance.ts', 'lib/access/crmCache.ts']) {
    hashes.push({ path, sha256: createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex') });
  }
  const path = join(fixture, 'components/CRMApp.tsx');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n// Test-only exports in the disposable copy.\nexport { QuotesView, HouseTrackingView, Dashboard };\n');
}
symlinkSync(join(repo, 'node_modules'), join(fixture, 'node_modules'), 'dir');
mkdirSync(join(fixture, 'app'));
writeFileSync(join(fixture, 'next.config.mjs'), 'export default { devIndicators: false, images: { unoptimized: true } };\n');
writeFileSync(join(fixture, 'app/layout.tsx'), 'export default function Layout({children}:{children:React.ReactNode}) { return <html lang="fr"><body>{children}</body></html>; }\n');
writeFileSync(join(fixture, 'app/page.tsx'), `"use client";
import { Suspense, startTransition, useEffect, useState } from "react";
import MobileCRMHeader from "@/components/MobileCRMHeader";
import SearchableBusinessContactPicker from "@/components/SearchableBusinessContactPicker";
import { useCommittedValue } from "@/lib/access/useCommittedValue";
import type { CRMTab } from "@/components/crmNavigation";
import type { Contact } from "@/lib/types";
const vendors: Contact[] = ["Alpha", "Beta", "Gamma"].map((name, index) => ({
  id: "fixture-" + name.toLowerCase(), name, companyName: "Atelier Démo " + name,
  kind: "Prestataire", email: "", phone: "", city: "Ville fictive", budget: 0,
  source: "", notes: "Données fictives", createdAt: "2026-09-17"
}));
const historic: Contact = {...vendors[0], id: "fixture-missing", companyName: "Contact retrouvé fictif"};
const probe = { attempts: [] as string[], release: () => {} };
const blocked = new Promise<void>(resolve => { probe.release = resolve; });
function CommitProbe({value, onRead}: {value: string; onRead:(value:unknown)=>void}) {
  const latest = useCommittedValue({token: value, payload: {label: value}});
  const [readCommitted] = useState(() => () => onRead(latest.current));
  if (value === "B") { probe.attempts.push(value); throw blocked; }
  return <section><output id="probe-committed">{value}</output><button onClick={readCommitted}>Read committed callback</button></section>;
}
export default function Fixture() {
  const [tab, setTab] = useState<CRMTab>("contacts");
  const [query, setQuery] = useState("");
  const [incidental, setIncidental] = useState(0);
  const [defaults, setDefaults] = useState({id: vendors[0].id, fallback: ""});
  const [contacts, setContacts] = useState(vendors);
  const [probeValue, setProbeValue] = useState("A");
  const [observed, setObserved] = useState<unknown>(null);
  const [actionCount, setActionCount] = useState(0);
  useEffect(() => { (window as any).__componentProbe = probe; return () => { delete (window as any).__componentProbe; }; }, []);
  return <main>
    <h1>Fixture composants et commits React</h1>
    <button onClick={() => setTab("contacts")}>Tab contacts</button>
    <button onClick={() => setTab("leads")}>Tab leads</button>
    <button onClick={() => setIncidental(value => value + 1)}>Incidental props</button>
    <output id="tab">{tab}</output><output id="query">{query}</output><output id="action-count">{actionCount}</output>
    <MobileCRMHeader activeActor={"Fictif " + incidental} activeTab={tab} actors={["Fictif " + incidental]} query={query}
      sessionEmail="fixture@example.invalid" actions={[{label:"Action fictive",onClick:()=>setActionCount(value=>value+1)}]}
      onActorChange={()=>{}} onQueryChange={setQuery} />
    <button onClick={() => setDefaults({id: vendors[1].id, fallback: ""})}>Default Beta</button>
    <button onClick={() => setDefaults({id: "fixture-missing", fallback: "Historique fictif"})}>Legacy default</button>
    <button onClick={() => setDefaults(value => ({...value, fallback: "Historique fictif modifié"}))}>Change legacy name</button>
    <button onClick={() => setContacts([...vendors, historic])}>Resolve legacy contact</button>
    <button onClick={() => setContacts(vendors)}>Restore contacts</button>
    <button onClick={() => {setDefaults({id:"",fallback:""});setContacts(vendors);}}>Empty defaults</button>
    <button onClick={() => setContacts([vendors[0]])}>Shrink results</button>
    <form id="picker-form" onSubmit={event => event.preventDefault()}>
      <SearchableBusinessContactPicker contacts={contacts.map(contact=>({...contact}))} defaultContactId={defaults.id}
        fallbackContactName={defaults.fallback} label={"Prestataire " + incidental} fallbackPhone={"Fictif " + incidental} />
      <button type="reset">Reset picker</button>
    </form>
    <button onClick={() => startTransition(() => setProbeValue("B"))}>Suspend B</button>
    <button onClick={() => setProbeValue("C")}>Commit C</button>
    <button onClick={() => probe.release()}>Release abandoned B</button>
    <button onClick={() => setProbeValue("D")}>Commit D</button>
    <Suspense fallback={<p id="probe-fallback">Suspended</p>}><CommitProbe value={probeValue} onRead={setObserved} /></Suspense>
    <output id="probe-observed">{JSON.stringify(observed)}</output>
  </main>;
}
`);
if (includeCRMViews) {
  mkdirSync(join(fixture, 'app/crm-views'));
  writeFileSync(join(fixture, 'app/crm-views/page.tsx'), `"use client";
import { useEffect, useState } from "react";
import CRMApp, { QuotesView, HouseTrackingView, Dashboard } from "@/components/CRMApp";
import { bindCRMCache, clearCRMCache, crmCache } from "@/lib/access/crmCache";
import { supabase } from "@/lib/supabase";
import type { Contact, CRMData, HouseTrackingWorker } from "@/lib/types";
const client: Contact = {id:"fixture-client",name:"Client Fictif",kind:"Client",email:"",phone:"",city:"Ville fictive",budget:0,source:"",notes:"Fictif",createdAt:"2026-09-17"};
const blank: CRMData = {contacts:[client],leads:[],properties:[],vehicles:[],boats:[],tasks:[],suppliers:[],planningEntries:[],quotes:[],vendorQuotes:[],vendorInvoices:[],documents:[],houseTrackingHouses:[],houseTrackingWorkers:[],houseTimeEntries:[],housePayments:[]};
const initialQuote = {id:"fixture-quote",clientName:client.name,title:"Devis initial fictif",location:"Ville fictive",guestCount:"",categories:["Villa"],startDate:"2026-10-01",endDate:"2026-10-03",unitPrice:200,validityDate:"",paymentTerms:"",cancellationTerms:"",included:"",excluded:"",notes:"Note fictive",status:"Draft" as const,createdAt:"2026-09-17"};
const request = {key:"fixture-request",clientName:client.name,category:"Villa",title:"Préremplissage explicite fictif",location:"Lieu du lead fictif",startDate:"2026-10-01",endDate:"2026-10-03",unitPrice:150,notes:"Demande fictive"};
const initialWorkers: HouseTrackingWorker[] = ["Alpha","Beta","Gamma"].map((name,index)=>({id:"fixture-worker-"+index,contactId:"fixture-worker-contact-"+index,contactName:"Intervenant fictif "+name,role:"Entretien",hourlyRate:20+index*10,status:"Actif",createdAt:"2026-09-17"}));
let authCalls = 0;
export default function ViewsFixture() {
  const [quotes,setQuotes] = useState([initialQuote]);
  const [refreshCount,setRefreshCount] = useState(0);
  const [prefill,setPrefill] = useState<(typeof request & {quoteId?:string}) | null>(null);
  const [workers,setWorkers] = useState(initialWorkers);
  const [tick,setTick] = useState(0);
  const [action,setAction] = useState("");
  const [mount,setMount] = useState<"valid" | "corrupt" | null>(null);
  useEffect(()=>{const clicks:string[]=[];const record=(event:MouseEvent)=>{const button=(event.target as Element)?.closest("button");if(button)clicks.push(button.textContent||"");};document.addEventListener("click",record);(window as any).__crmViewsFixture={readCache:()=>crmCache.getItem("oneaddress-riviera-crm-v1"),authCalls:()=>authCalls,clicks};return()=>{document.removeEventListener("click",record);delete (window as any).__crmViewsFixture;};},[]);
  function mountCRM(corrupt:boolean) {
    // This stub exists only in the generated test page. It never authorizes a user
    // and prevents cloud/actor-lock responses while testing initialization.
    supabase.auth.getUser = () => {authCalls++;return new Promise<never>(()=>{});};
    clearCRMCache();bindCRMCache("fixture-local-owner");
    const now=Date.now();
    const payload={...blank,leads:[{id:"fixture-visit",contactName:client.name,request:"Visite fictive conservée",status:"Visite",value:0,createdAt:"2026-09-17",nextAction:"",nextActionDate:""}],tasks:[
      {id:"fixture-task-old",title:"Ancienne tâche fictive",status:"Terminé",completedAt:new Date(now-4*86400000).toISOString(),dueDate:"",linkedTo:"",assignedTo:""},
      {id:"fixture-task-new",title:"Tâche terminée fictive",status:"Terminé",dueDate:"",linkedTo:"",assignedTo:""},
      {id:"fixture-task-open",title:"Tâche ouverte fictive",status:"À faire",dueDate:"",linkedTo:"",assignedTo:""}
    ]};
    crmCache.setItem("oneaddress-riviera-crm-v1",corrupt?"{invalid-json":JSON.stringify(payload));
    crmCache.setItem("oneaddress-riviera-crm-active-actor-v1","Vincent");
    setMount(corrupt?"corrupt":"valid");
  }
  return <main>
    <h1>Fixture des vues CRM</h1>
    <button id="crm-incidental" onClick={()=>setTick(value=>value+1)}>CRM incidental props</button><output id="crm-tick">{tick}</output>
    <button onClick={()=>setPrefill({...request})}>Explicit lead prefill</button>
    <button onClick={()=>{setRefreshCount(value=>value+1);setQuotes(current=>current.map(quote=>({...quote,title:"Devis serveur rafraîchi",unitPrice:900})));}}>Refresh quote props</button><output id="quote-props-title">{quotes[0]?.title}</output><output id="quote-refresh-count">{refreshCount}</output>
    <button onClick={()=>setPrefill({...request,quoteId:"fixture-quote"})}>Explicit quote prefill</button>
    <section id="quotes-fixture"><QuotesView contacts={[client]} prefilledLead={prefill} quotes={quotes} activeActor="Acteur fictif" onChange={setQuotes as any} /></section>
    <button onClick={()=>setWorkers(current=>current.map(worker=>worker.id==="fixture-worker-1"?{...worker,status:"Inactif"}:worker))}>Archive selected Beta</button>
    <button onClick={()=>setWorkers(current=>current.filter(worker=>worker.id!=="fixture-worker-0"))}>Delete selected Alpha</button>
    <button onClick={()=>setWorkers(initialWorkers)}>Restore fixture workers</button>
    <button onClick={()=>setWorkers([])}>Remove all fixture workers</button>
    <section id="house-fixture"><HouseTrackingView contacts={[]} houses={[{id:"fixture-house",name:"Maison fictive",address:"Adresse fictive",createdAt:"2026-09-17"}]}
      workers={workers.map(worker=>({...worker}))} timeEntries={[]} payments={[]} onAddHouse={()=>{}} onDeleteHouse={()=>{}} onAddWorker={()=>{}}
      onArchiveWorker={()=>{}} onReactivateWorker={()=>{}} onPermanentlyDeleteWorker={()=>{}} onAddTimeEntry={()=>{}} onDeleteTimeEntry={()=>{}} onAddPayment={()=>{}} onDeletePayment={()=>{}} /></section>
    <section id="dashboard-fixture"><Dashboard stats={{pipeline:0,won:0,openTasks:0,availableProperties:0}} data={{...blank}}
      onLeadStatusChange={()=>{}} onTaskStatusChange={()=>{}} onStartMessage={()=>setAction("message-"+tick)} onStartContactLead={()=>{}} onStartInventory={()=>{}}
      onShowLeads={()=>setAction("leads-"+tick)} onCloudBackup={()=>{}} onDashboardAction={tab=>setAction(tab+"-"+tick)} /></section><output id="dashboard-action">{action}</output>
    <button onClick={()=>mountCRM(false)}>Mount CRM from RAM</button>
    <button onClick={()=>mountCRM(true)}>Mount CRM corrupt cache</button>
    <button onClick={()=>{setMount(null);clearCRMCache();}}>Unmount fixture CRM</button>
    {mount && <section id="mounted-crm"><CRMApp key={mount} sessionUserId="fixture-local-owner" sessionAccessToken="fixture-not-a-token" sessionEmail="fixture@example.invalid" onLogout={()=>setMount(null)} /></section>}
  </main>;
}
`);
}
const guard = readFileSync(join(repo, 'tests/izord/local-network-guard.cjs'), 'utf8');
assert.ok(guard.includes('new Set([3159, 55431])'));
writeFileSync(join(fixture, 'network-guard.cjs'), guard.replace('new Set([3159, 55431])', 'new Set([3163])'));
const browserConfig = join(fixture, 'browser-config.json');
writeFileSync(browserConfig, '{}');
const browserEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const env = { ...browserEnv, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', IZORD_TEST_ACK: 'IZORD_DISPOSABLE_LOCAL_ONLY', NODE_OPTIONS: `--require=${join(fixture, 'network-guard.cjs')}`, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3163/fixture-unused-auth', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fictional-local-ui-key' };
const child = spawn(process.execPath, [join(repo, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3163'], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { serverLog += chunk; });
const exited = new Promise(resolveExit => child.once('exit', resolveExit));
const binary = process.env.AGENT_BROWSER_BIN || '/tmp/izord-browser-runtime/node_modules/.bin/agent-browser';
const session = `izord-component-state-${process.pid}`;
const ab = (...args) => execFileSync(binary, ['--config', browserConfig, '--session', session, ...args], { env: browserEnv, encoding: 'utf8', timeout: 45000 }).trim();
const evaluate = code => JSON.parse(ab('eval', code));
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
const report = {
  kind: includeCRMViews ? 'real React component/views fixture; Auth blocked only in the temporary page for cache initialization; not authorization proof' : 'real React component fixture; no Auth or business services',
  startedAt, browserSession: session, sourceHashes: hashes, checks: [], failures: []
};
async function waitFor(code, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (evaluate(code)) return; await pause(100); }
  throw Error(`Timeout: ${label}`);
}
function button(name) { ab('find', 'role', 'button', 'click', '--name', name, '--exact'); ab('snapshot', '-i'); }
function fixtureControl(name) {
  // These English controls only change fixture props. Dispatch their DOM click
  // directly so the product's intentional form scrolling cannot misdirect it.
  assert.equal(evaluate(`(()=>{const buttons=Array.from(document.querySelectorAll('button')).filter(button=>button.textContent===${JSON.stringify(name)});if(buttons.length!==1)return false;buttons[0].click();return true})()`), true);
  ab('snapshot', '-i');
}
function keyboardButton(name) {
  assert.equal(evaluate(`(()=>{const buttons=Array.from(document.querySelectorAll('button')).filter(button=>button.textContent.trim()===${JSON.stringify(name)});if(buttons.length!==1)return false;buttons[0].focus();return document.activeElement===buttons[0]})()`), true);
  ab('press', 'Enter');
  ab('snapshot', '-i');
}
function fill(query) {
  // Keep the pointer off the results: hovering an option intentionally changes
  // the active index and must not influence this keyboard-only scenario.
  ab('mouse', 'move', '0', '0');
  ab('fill', '[role=combobox]', query);
  ab('snapshot', '-i');
}
const selected = () => evaluate('document.querySelector("input[name=contactId]").value');
const active = () => evaluate('document.querySelector("[role=combobox]")?.getAttribute("aria-activedescendant") ?? null');
const card = () => evaluate('document.querySelector(".business-contact-picker-selection")?.textContent || ""');
function pass(label) { report.checks.push(label); console.log('PASS ' + label); }
async function readProbe(expected) {
  button('Read committed callback');
  await waitFor(`document.querySelector('#probe-observed').textContent === ${JSON.stringify(JSON.stringify({token:expected,payload:{label:expected}}))}`, `callback observes ${expected}`);
}
try {
  for (let i = 0; !serverLog.includes('Ready'); i++) { if (i > 150 || child.exitCode !== null) throw Error('Fixture server did not start'); await pause(100); }
  report.browserOpenRequestedAt = new Date().toISOString();
  ab('--allowed-domains', '127.0.0.1', 'open', 'http://127.0.0.1:3163');
  ab('network', 'route', 'https://*', '--abort'); ab('snapshot', '-i');
  await waitFor('!!window.__componentProbe && !!document.querySelector("input[name=contactId]")', 'fixture hydrated');
  assert.equal(selected(), 'fixture-alpha'); assert.match(card(), /Atelier Démo Alpha/);
  pass('Picker initial default is available after hydration');

  button('Ouvrir la recherche');
  await waitFor('document.activeElement?.type === "search"', 'mobile search focus');
  ab('fill', '.mobile-search-field input', 'Fiction');
  button('Incidental props');
  assert.equal(evaluate('!!document.querySelector(".mobile-search-sheet")'), true);
  assert.equal(evaluate('document.querySelector("#query").textContent'), 'Fiction');
  button('Tab leads');
  await waitFor('!document.querySelector(".mobile-search-sheet") && document.body.style.overflow !== "hidden"', 'tab closes search and unlocks body');
  button('Tab contacts'); assert.equal(evaluate('!!document.querySelector(".mobile-search-sheet")'), false);
  button('Ouvrir la recherche'); ab('press', 'Escape');
  await waitFor('!document.querySelector(".mobile-search-sheet")', 'Escape closes search');
  pass('Mobile search survives incidental props but closes on tab change, stays closed on return, and handles Escape');

  button('Ouvrir les actions'); button('Tab leads');
  assert.equal(evaluate('!!document.querySelector(".mobile-actions-sheet")'), true);
  button('Action fictive'); assert.equal(evaluate('document.querySelector("#action-count").textContent'), '1');
  assert.equal(evaluate('!!document.querySelector(".mobile-actions-sheet")'), false);
  pass('Mobile actions retain their independent state across tab changes');

  button('Changer'); await waitFor('document.activeElement?.getAttribute("role") === "combobox"', 'picker focused');
  fill('démo'); await waitFor('document.querySelectorAll("[role=option]").length === 3', 'normalized search results');
  assert.equal(active(), null, 'Keyboard starts without a pointer-selected option');
  ab('press', 'ArrowDown'); ab('press', 'ArrowDown'); ab('press', 'Enter');
  assert.equal(selected(), 'fixture-beta'); button('Incidental props');
  assert.equal(selected(), 'fixture-beta'); assert.match(card(), /Atelier Démo Beta/);
  pass('Search and keyboard selection survive equivalent contact objects and unrelated props');

  button('Reset picker'); assert.equal(selected(), 'fixture-alpha'); assert.match(card(), /Atelier Démo Alpha/);
  button('Default Beta'); assert.equal(selected(), 'fixture-beta');
  pass('Native form reset restores the default and a changed default replaces the selection');

  button('Legacy default'); assert.match(card(), /Historique fictif/);
  assert.equal(evaluate('document.querySelector("input[name=preserveLegacyContact]").value'), 'true');
  button('Change legacy name'); assert.match(card(), /Historique fictif modifié/);
  button('Resolve legacy contact'); assert.match(card(), /Contact retrouvé fictif/);
  assert.equal(evaluate('document.querySelector("input[name=preserveLegacyContact]").value'), '');
  button('Restore contacts'); assert.match(card(), /Historique fictif modifié/);
  assert.equal(evaluate('document.querySelector("input[name=preserveLegacyContact]").value'), 'true');
  button('Effacer'); assert.equal(selected(), '');
  button('Reset picker'); assert.equal(selected(), 'fixture-missing'); assert.match(card(), /Historique fictif modifié/);
  pass('Fallback changes, contact arrival/removal and reset preserve legacy semantics');

  button('Empty defaults'); fill('atelier'); ab('press', 'ArrowUp'); assert.ok(active()?.endsWith('-option-2'));
  button('Shrink results'); assert.equal(active(), null);
  ab('click', '[role=combobox]'); ab('press', 'Enter'); assert.equal(selected(), '');
  ab('press', 'ArrowDown'); ab('press', 'Enter'); assert.equal(selected(), 'fixture-alpha');
  pass('Shrinking results invalidates the old keyboard index before Enter can select');

  button('Effacer'); fill('atelier'); button('Incidental props');
  assert.equal(evaluate('document.querySelector("[role=combobox]").value'), 'atelier');
  assert.equal(evaluate('document.querySelector("[role=combobox]").getAttribute("aria-expanded")'), 'false');
  ab('click', '[role=combobox]'); ab('press', 'Escape');
  assert.equal(evaluate('document.querySelector("[role=combobox]").getAttribute("aria-expanded")'), 'false');
  pass('Outside click and Escape close search without erasing its query');

  await readProbe('A'); pass('Committed-value callback reads the initial committed token and payload');
  button('Suspend B');
  await waitFor('window.__componentProbe.attempts.includes("B")', 'concurrent B render actually suspended');
  assert.equal(evaluate('document.querySelector("#probe-committed").textContent'), 'A');
  await readProbe('A'); pass('Concurrent suspended render cannot publish its token or payload');
  button('Commit C'); await waitFor('document.querySelector("#probe-committed").textContent === "C"', 'C committed');
  await readProbe('C'); button('Release abandoned B');
  await readProbe('C'); button('Commit D'); await readProbe('D');
  pass('Abandoned render stays unpublished and later commits update existing callbacks');
  if (includeCRMViews) {
    ab('open', 'http://127.0.0.1:3163/crm-views'); ab('snapshot', '-i');
    await waitFor('!!window.__crmViewsFixture && !!document.querySelector("#quotes-fixture form[data-quote-form]")', 'CRM views fixture hydrated');
    const field = name => evaluate(`document.querySelector('#quotes-fixture [name=${JSON.stringify(name)}]').value`);
    fixtureControl('Explicit lead prefill');
    await waitFor('document.querySelector("#quotes-fixture input[name=title]").value === "Préremplissage explicite fictif"', 'explicit lead prefill applied');
    assert.equal(field('clientName'), 'Client Fictif');
    assert.equal(field('location'), 'Lieu du lead fictif');
    assert.equal(evaluate('document.querySelector("#quotes-fixture input[name=categories][value=Villa]").checked'), true);
    pass('Quotes apply an explicit lead prefill with client, fields and category');

    ab('fill', '#quotes-fixture input[name=title]', 'Saisie locale non sauvegardée');
    fixtureControl('Refresh quote props');
    await waitFor('document.querySelector("#quote-props-title").textContent === "Devis serveur rafraîchi" && document.querySelector("#quote-refresh-count").textContent === "1"', 'actual refreshed quote props');
    assert.equal(field('title'), 'Saisie locale non sauvegardée');
    pass('Refreshing quote props does not overwrite an in-progress lead draft');

    fixtureControl('Explicit quote prefill');
    await waitFor('document.querySelector("#quotes-fixture input[name=title]").value === "Devis serveur rafraîchi"', 'explicit quote loads latest snapshot');
    ab('fill', '#quotes-fixture input[name=title]', 'Édition locale du devis');
    fixtureControl('Refresh quote props');
    await waitFor('document.querySelector("#quote-refresh-count").textContent === "2"', 'second actual quote props refresh');
    assert.equal(field('title'), 'Édition locale du devis');
    fixtureControl('Explicit quote prefill');
    await waitFor('document.querySelector("#quotes-fixture input[name=title]").value === "Devis serveur rafraîchi"', 'second explicit request replaces draft');
    pass('Existing quote drafts survive prop refresh and reload only on an explicit prefill request');

    const worker = '#house-fixture .house-compact-form label:nth-of-type(3) select';
    const rate = '#house-fixture .house-compact-form input[step="0.5"]';
    const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
    keyboardButton('Heures');
    assert.equal(value(worker), 'fixture-worker-0'); assert.equal(value(rate), '20');
    ab('select', worker, 'fixture-worker-1'); assert.equal(value(rate), '30');
    ab('fill', rate, '77.5'); fixtureControl('CRM incidental props');
    assert.equal(value(worker), 'fixture-worker-1'); assert.equal(value(rate), '77.5');
    pass('House tracking preserves a typed hourly rate across unrelated prop updates');

    keyboardButton('Intervenant fictif Beta'); fixtureControl('Archive selected Beta');
    assert.equal(value(worker), 'fixture-worker-0'); assert.equal(value(rate), '20');
    keyboardButton('Aujourd’hui');
    assert.equal(evaluate('document.querySelector("#house-fixture .house-worker-filter-button").getAttribute("aria-pressed")'), 'true');
    pass('Archiving the selected worker chooses the first active worker/rate and resets an invalid Today filter');

    keyboardButton('Heures'); keyboardButton('Intervenant fictif Alpha'); fixtureControl('Delete selected Alpha');
    assert.equal(value(worker), 'fixture-worker-2'); assert.equal(value(rate), '40');
    assert.equal(evaluate('document.querySelector("#house-fixture .house-worker-filter-button").getAttribute("aria-pressed")'), 'true');
    fixtureControl('Remove all fixture workers'); assert.equal(value(worker), ''); assert.equal(value(rate), '');
    pass('Deleting a selected worker resets selection, rate and invalid filter, including the empty list');

    const beforeTick = Number(evaluate('document.querySelector("#crm-tick").textContent'));
    evaluate(`(()=>{window.__dashboardFixtureNodes=Array.from(document.querySelectorAll('#dashboard-fixture .dashboard-command-kpi-tile,#dashboard-fixture .dashboard-command-actions button'));window.__dashboardFixtureNodes[0].focus();document.querySelector('#crm-incidental').click();return true})()`);
    await waitFor(`document.querySelector('#crm-tick').textContent === ${JSON.stringify(String(beforeTick+1))}`, 'dashboard props updated');
    assert.equal(evaluate(`(()=>{const current=Array.from(document.querySelectorAll('#dashboard-fixture .dashboard-command-kpi-tile,#dashboard-fixture .dashboard-command-actions button'));return current.length===6 && current.every((node,index)=>node===window.__dashboardFixtureNodes[index]) && document.activeElement===window.__dashboardFixtureNodes[0]})()`), true);
    ab('press', 'Enter');
    await waitFor(`document.querySelector('#dashboard-action').textContent === ${JSON.stringify('vendorInvoices-'+String(beforeTick+1))}`, 'dashboard current callback executed');
    pass('Dashboard tiles and card buttons retain DOM identity/focus while callbacks receive current props');

    fixtureControl('Mount CRM from RAM');
    await waitFor('document.querySelector("#mounted-crm .crm-actor-select-label select")?.value === "Vincent"', 'RAM actor restored');
    await waitFor('JSON.parse(window.__crmViewsFixture.readCache()).tasks.some(task=>task.id==="fixture-task-new" && !!task.completedAt)', 'task maintenance applied');
    const cached = evaluate('JSON.parse(window.__crmViewsFixture.readCache())');
    assert.equal(cached.contacts[0].notes, 'Fictif'); assert.equal(cached.leads[0].status, 'Visite');
    assert.deepEqual(cached.tasks.map(task=>task.id), ['fixture-task-new','fixture-task-open']);
    assert.ok(evaluate('window.__crmViewsFixture.authCalls()') >= 1);
    assert.equal(evaluate('Object.keys(localStorage).some(key=>key.startsWith("oneaddress-riviera-crm-"))'), false);
    pass('Real CRM mount restores RAM actor/data, preserves legacy Visite and maintains completed tasks without cloud Auth');
    fixtureControl('Unmount fixture CRM'); await waitFor('!document.querySelector("#mounted-crm")', 'CRM unmounted');
    fixtureControl('Mount CRM corrupt cache');
    await waitFor('document.querySelector("#mounted-crm .toast")?.textContent === "Impossible de lire la sauvegarde locale."', 'corrupt-cache warning');
    assert.equal(evaluate('JSON.parse(window.__crmViewsFixture.readCache()).contacts.length'), 0);
    fixtureControl('Unmount fixture CRM'); await waitFor('!document.querySelector("#mounted-crm")', 'corrupt CRM unmounted');
    pass('An unreadable RAM cache renders the explicit warning and safe empty state');
  }
  assert.equal(ab('errors'), '');
  ab('screenshot', join(artifacts, 'component-state.png'));
} catch (error) {
  report.failures.push({message:String(error.message)});
  try {
    report.fixtureFailureState = evaluate(`({quoteTitle:document.querySelector('#quotes-fixture input[name=title]')?.value,quotePropsTitle:document.querySelector('#quote-props-title')?.textContent,quoteRefreshCount:document.querySelector('#quote-refresh-count')?.textContent,clicks:window.__crmViewsFixture?.clicks?.slice(-8),quoteForms:document.querySelectorAll('form[data-quote-form]').length,quoteHeading:document.querySelector('#quotes-fixture form[data-quote-form]')?.parentElement?.querySelector('h3')?.textContent,crmMounted:!!document.querySelector('#mounted-crm')})`);
    report.browserErrors = ab('errors');
    ab('screenshot', join(artifacts, 'failure.png'));
  } catch { /* The browser may not have started. */ }
  process.exitCode = 1; console.error(error.message);
}
finally {
  report.browserCloseRequestedAt = new Date().toISOString();
  try { ab('close'); } catch { /* Preserve the original failure. */ }
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([exited, pause(5000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  writeFileSync(join(artifacts, 'server.log'), serverLog);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(artifacts, 'component-state-results.json'), JSON.stringify(report, null, 2));
  console.log('Artifacts: ' + artifacts);
}
