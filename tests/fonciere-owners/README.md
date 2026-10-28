# Project-only owners and sale context

`model.test.ts` runs through the existing TypeScript test loader:

```sh
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere-owners/model.test.ts
```

`server.mjs` reuses the real disposable Auth/PostgREST/PostgreSQL stack and private
fixture described in `tests/fonciere-arbitrage/README.md`. It requires the same
`IZORD_TEST_ACK`, `ARBITRAGE_STATUS_FILE` and optional `ARBITRAGE_OUTPUT` values.
Apply the owner migration before running the initial arbitrage prepare because
new project data includes the owner defaults. The owner server test installs the
arbitrage migration if absent and creates only fictional `example.invalid`
fixtures. It never loads repository environment files or contacts production.

The sanitized server report describes actual RPC/SQL checks; the private shared
fixture adds `owners.person1`, `person2`, `company`, `representative`, and `project`
for the browser campaign. Credentials and fixture files stay outside Git.

The checks cover optional/legacy defaults, sole ownership, indivision with partial
identified contacts, split rights, company/representative separation, strict shape
and canonical contact admission, actual actor attribution, Contacts and project
ACL, omission preservation, same-save agent primary contact admission, linked
identity retention, source-reference authorization, arbitration invalidation,
read-only derived displays, helper grants, hidden presentation payload rejection,
and independent new projects. Presentation JSON/PPTX and browser controls use the
separate campaigns in this directory.
