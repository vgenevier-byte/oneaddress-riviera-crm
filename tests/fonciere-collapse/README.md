# Foncière section disclosure regressions

`browser.mjs` reuses the source-identical production server and disposable
Auth/PostgREST/Storage stack described in `tests/fonciere-arbitrage/README.md`.
The fixture must contain the fictional owner contacts from the owner campaign.
It uses no success-response mocks and restricts browser egress to the owned local
application and Supabase services. Never point it at production or load a
repository environment file.

Run the production server with the current sources, then:

```sh
COLLAPSE_FIXTURE=/path/to/owned/arbitrage-fixture.private.json \
COLLAPSE_OUTPUT=/path/to/sanitized/evidence \
node tests/fonciere-collapse/browser.mjs
```

The campaign creates fictional projects/contacts and uploads a fictional PDF. It
covers eight independent disclosures, compact initial states, mounted/inert
panels, keyboard and touch controls, focus recovery, local draft preservation,
hidden validation including nested owner fields and unfinished contact searches,
all Contacts return roles, save/reload and draft identity transfer, incoming
anchors/document tasks, draft/project isolation, read-only arbitration drafts,
FR/EN, mobile, and archiving. The two requested desktop captures and a supplemental
mobile capture are written with a sanitized JSON result. Keep the fixture and
credentials outside this directory and outside the evidence directory.
