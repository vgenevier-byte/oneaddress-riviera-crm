# Coverage: modules outside CRMApp and specialized Foncière/Publisher controls

Data-backed selectors use the shared SearchableSelect. Typing searches only the options supplied by the existing authorized projection; committing a result dispatches the original native select change and preserves actual IDs, disabled options, business callbacks and FormData semantics. Searches run over the whole eligible collection before suggestions are bounded.

| Surface | Converted controls / searches |
| --- | --- |
| Mobile header | Actor selection; module search remains delegated to its module |
| Tasks | Authorized account assignees, linked enquiries; indexed task search across visible title, notes, verified participant identity, manager, authorized linked enquiry/contact fields; no-query due-date/priority ordering retained |
| Task identity administration | Active accounts, organization Contact identity, explicitly eligible manager; searchable participant checkbox list with original explicit approval safeguards |
| Access administration | Searchable user buttons and project assignment checkboxes; grants and invitation workflow unchanged |
| Contact Documents | Authorized sharing recipients; ranked title, filename and document-type search in the private library |
| Scoped Documents | Folder filter, owner module catalogue and owner record; ranked authorized title/folder/module search, separate personal document renderer retained |
| Vendor payment preparation | Invoice and verified bank account selection; invoice title/reference/supplier/date; bank search uses the already displayed masked IBAN only |
| Monthly Charges | House filter; indexed authorized supplier/worker and expense selection search; amount, rule, exception and attachment calculations unchanged |
| Presentations Projets / IZORD | Searchable accessible dossiers, extracted PDF file selection, photo gallery and imported-photo assignment; original positional photo indices preserved |
| Address reuse | Authorized existing addresses searchable by record label and address; original explicit “Use this address” and replacement confirmation retained |
| Quick replies | Situation/category catalogue suggestions; indexed localized title, situation, category, channel and message search |
| Restricted Contacts banking sections | Shared ranked contact index with persistent companyId lookup within the same authorized projection |

Approximate list matches use the shared discreet FR/EN SearchMatchHint; selectors display their own equivalent hint.

## Remaining native controls

Every native `<select>` remaining in these surfaces has a closed short or chronological domain:

- QuickRepliesView: channel (`All`, WhatsApp, Email), three fixed values.
- ContactDocuments: personal document type, six fixed legal/business classifications, including Other.
- AccessAdministration: module grant (`none/read/contribute`) and IZORD role (none + four fixed authorization roles).
- TasksWorkspace: relation filter, task status and task priority, each three fixed business values (+ All in filters). Task board status controls retain the same order and capability checks.
- MonthlyChargesWorkspace: source (`all/invoice/hours`), the twelve months in chronological order, expense rule (`auto/include/exclude`), and attachment mode (`default/month/spread`). The month control is a calendar control; alphabetical relevance would be inappropriate.
- IzordGenerator: field metadata defines only rental presentation mode (3), legal regime (2), resale basis (2), sea view (4), project decision (5), plus workflow status (3). All are fixed business choices, not record catalogues.
- BusinessPermissions.BusinessSelect remains the permission-aware primitive for callers; its remaining call sites are separately inventoried in CRMApp coverage.

No datalist remains in this coverage scope. Existing address completion remains a provider-backed geographical lookup with manual entry, cancellation, accessible suggestions, bounded results and no CRM permission expansion. Other text inputs (notes, names, references and arbitrary address/country text) preserve their existing free-entry semantics.

## Verification scope

TypeScript and targeted lint run against these real source files. Targeted task domain tests exercise the shared fuzzy engine while retaining authorization and chronological ordering. Browser fixtures, when recorded in the adjacent test report, use fictional data and do not establish authenticated production persistence or authorization.


Verified locally on 2026-10-24: TypeScript, targeted ESLint and diff-check passed; all 22 task domain tests passed. The real-component browser fixture passed 48 checks across installed Chrome/Chromium and WebKit, each at desktop and 390 px touch/mobile emulation. It covers explicit selection, linked company/city, reordered words and typos, absent results, an empty catalogue, initial 12 / Show more 36, record index 1399, loading/error/disabled eligibility, optional clear, required validity, native reset, homonyms, FR/EN, form values after fictional local reload, native controlled/uncontrolled input updates, task dialog Escape, implicit label association, overflow-hidden card hit testing, and the A → B → unavailable A selection-retention regression. Four browser sessions recorded zero page errors and zero external requests. Eight screenshots are in `screenshots/`; source hashes and the precise fixture limitations are in `fixture-manifest.json` and `browser-results.json`.

Browser persistence is simulated with localStorage. These checks do not exercise authenticated production RPC writes, production RLS, actual mobile hardware or an integrated CRM page layout.
