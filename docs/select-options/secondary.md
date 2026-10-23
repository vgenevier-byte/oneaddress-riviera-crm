# Dropdown ordering: secondary CRM surfaces

All alphabetic rules below use `sortSelectOptions` with the current UI language and the exact displayed label. The helper sorts a copy at render time. Existing controlled values, stored IDs, handlers, defaults, disabled options and keyboard behavior remain in place. A placeholder rendered before the sorted options is explicitly a first-position choice; it does not participate in alphabetic ordering.

| Component / fields | Rule | Particular options and scope |
| --- | --- | --- |
| `MobileCRMHeader`: active actor | Alphabetic on actor name | Empty “Unspecified” choice first; only the mobile dropdown changes. |
| `QuickRepliesView`: situation, category, channel filters | Alphabetic on translated visible label | `Toutes` / `Tous` are explicit all-results filters and stay first. Template cards retain their existing order and selected default. |
| `ContactDocuments`: grant recipient; queued document type | Alphabetic on email; translated document type | Empty recipient placeholder first. `Autre` is explicitly a document-type complement and stays last. Applies to the shared full/limited document renderer. The initial/new replacement type is unchanged. |
| `ScopedDocuments`: folder filter, owner module, owner record | Alphabetic on folder name, translated module label, displayed record name/title/contact name/ID fallback | Empty all-folders/choose placeholders first. Existing authorised projection and filtering unchanged; document cards are not reordered. |
| `ScopedInvoicePayments`: invoice, verified bank account | Alphabetic on invoice title and complete displayed bank account label | Empty explicit-choice placeholders first; primary account is a label suffix, not a pin or a new default. No account/invoice state is selected by ordering. |
| `VendorBanking` / `VendorInvoicePayment`: verified bank account | Alphabetic on complete displayed label/account holder + masked IBAN + primary suffix | Empty “Choose an account” first. Explicit/historical primary-account default is resolved by the existing business function before rendering; disabled paid-invoice account options remain disabled. Account cards unchanged. |
| `TaskIdentityAdministration`: active account, organisation member record, designated manager | Alphabetic on complete displayed account/manager label or contact label | Empty choose placeholders first. The screen's existing French labels are preserved. Participant checkboxes and historical task list retain their order. |
| `TasksWorkspace`: add assignee, linked enquiry | Alphabetic on complete displayed assignee label and enquiry label | Empty select-assignee/no-linked-enquiry first; a retained unavailable enquiry is integrated in the same alphabetic list by its displayed retained-link label. The selected-recipient chips and contact-search ranking remain unchanged. |
| `AddressField`: reuse an authorised record's existing address | Alphabetic on the source's displayed label | Empty placeholder first. Each option retains the original source index as its value, so reordering cannot choose the wrong address. Address text and IGN suggestions are unchanged. |
| `MonthlyChargesWorkspace`: source and house filters | Alphabetic on translated source label and house name | `all`/empty all-results filters first; authorised source list unchanged. The non-dropdown annual table, expense cards and people checkboxes retain their existing presentation. |
| `PublisherPage` / `CreativeSelector`: car type, brand, model | Alphabetic on translated type/model label or displayed brand name | `auto` is explicitly the any-type/any-brand/any-model choice and stays first. Brand/model compatibility, reconciliation, canonical IDs and selected direction are unchanged. Only the Voitures controls are affected. |

## Explicit non-alphabetic rules

| Component / fields | Preserved rule |
| --- | --- |
| `AccessAdministration`: module access level, IZORD role | Business progression: none → read → contribute; no role → reader → contributor → partner → administrator. No permissions or module row order changes. |
| `TasksWorkspace`: task status, priority, progress selectors and filters | Business progression and priority scale; all-status/all-priority filter options stay first. |
| `TasksWorkspace`: relation filter | Scope progression: all tasks involving me → assigned to me → created by me. |
| `MonthlyChargesWorkspace`: month | Chronological January–December, with current/future markers unchanged. Year, date, amount and duration inputs are unchanged. |
| `MonthlyChargesWorkspace`: expense selection and attachment mode | Business operation progression: automatic → include → exclude; default invoice date → one month → spread across months. |
| `AddressField`: IGN suggestion list | Provider relevance, unchanged. Reuse-address dropdown sorting is independent of the suggestion list. |
| `PublisherPage`: creative-universe, moment, style buttons; generation steps; music; history | Existing non-dropdown presentation and chronological/business order preserved. |
| `BusinessPermissions`: native select wrapper | Access/disabled behavior only; option ordering remains the caller's explicitly declared field rule. |

The primary CRM forms, limited-access module wrapper, Foncière guided fields, IZORD specifications and custom contact pickers are inventoried separately. No data, translation, permission, category identity or server projection is rewritten by these changes.
