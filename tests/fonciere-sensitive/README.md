# Foncière archive and document permissions

Run from the repository root. The transport fixtures below require no credentials or
network access. They distinguish canonical originals from the smaller photo previews,
check source-transfer admission before mutation, and preserve existing presentation
snapshots after source permission has been removed.

```sh
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere-sensitive/repository.test.ts
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere/model.test.ts tests/fonciere/guided.test.ts tests/fonciere/contactCreation.test.ts tests/fonciere/contacts.test.ts tests/fonciere/address.test.ts tests/fonciere/search-pagination.test.ts
node --test tests/fonciere-access/registry.test.cjs
```

`repository.test.ts` uses transport fixtures rather than authenticated services. It
checks that equal preview bytes do not merge distinct original photo references, that
an ordinary metadata save retains source documents without downloading or uploading
originals, and that denied new source admission leaves the caller's draft intact. A
current presentation containing an unchanged historical source snapshot remains
savable without authorizing a new source transfer.

## Disposable authenticated campaign

Use a newly created, explicitly owned Supabase stack from
`tests/prepaid-hours/server-stack.mjs`, with the installed Colima/Docker and Supabase
CLI runtimes. Follow `docs/izord/local-testing.md` for local runtime setup. The shared
test launcher's historical name does not change the data under test. Do not reset or
stop another stack. API `127.0.0.1:56031`, PostgreSQL `127.0.0.1:56032`, and the owned
application `127.0.0.1:3197` are the permitted endpoints.

Set the following variables to this new stack and a report directory. The status
file and generated fixture contain local credentials; keep both private and outside
Git and the report directory.

- `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`
- `FONCIERE_SENSITIVE_STATUS_FILE`: the owned stack's private `local-status.json`
- `FONCIERE_SENSITIVE_OUTPUT`: an absolute directory for public test evidence
- `FONCIERE_SENSITIVE_MIGRATION`: optional override of the final
  `*_fonciere_sensitive_permissions.sql` filename

Initialize the fictitious historical baseline and apply the migration once:

```sh
node tests/fonciere-sensitive/prepare.mjs
node tests/fonciere-sensitive/migration.mjs
```

`prepare.mjs` creates only `@example.invalid` accounts, real private JPEG/PDF assets,
project assignments and a historical presentation. It records private before-state
backups. `migration.mjs` compares business data, source references, history, roles,
levels, assignments, effective capabilities, and every other module's grants. A
second execution against the same migrated baseline is deliberately refused.

Serve an isolated production build in a separate terminal with:

- `PREPAID_HOURS_STATUS_FILE`: the same private status file
- `PREPAID_HOURS_TEST_ACK=PREPAID_HOURS_LOCAL_ONLY`
- `FONCIERE_SENSITIVE_SERVER_ACK=FONCIERE_SENSITIVE_OWNED_LOCAL_ONLY`
- `PREPAID_HOURS_APP_PORT=3197`

```sh
node tests/fonciere-sensitive/serve.mjs
```

This copies application sources without repository `.env` files, injects only the
owned stack's credentials, restricts egress to loopback, builds, and serves the copy.
The private application manifest records source hashes; compare them with the final
repository sources after any repair before claiming final browser coverage.

With the application ready, run:

```sh
node tests/fonciere-sensitive/server.mjs
node --conditions=react-server tests/fonciere-sensitive/preview-race.mjs
node tests/fonciere-sensitive/browser.mjs
```

For the browser command, set `FONCIERE_SENSITIVE_FIXTURE` to the private
`fonciere-sensitive-fixture.private.json` created beside the status file. An optional
`PLAYWRIGHT_MODULE` can select the installed Playwright package; the script otherwise
uses the bundled runtime. A repair rerun can use `FONCIERE_SENSITIVE_SERVER_ONLY` or
`FONCIERE_SENSITIVE_BROWSER_ONLY` to select named scenarios. Complete evidence requires
the final full campaigns, without those filters.

The server campaign exercises real password Auth, PostgREST/RPC, PostgreSQL and private
Storage, including readers with download permission, direct-call denials, archive and
reactivate, permission persistence/reconnection, revocation, source-transfer atomicity,
historical snapshots, and the preexisting task-reference export ceiling. The preview
race calls the actual server handler and revokes access between a real Storage read
and response authorization; its injected scheduling boundary does not mock admission
or image bytes.

The browser uses the real isolated application and fictitious authenticated accounts,
with no mocked success responses. It checks Administration, actual document download
and denied controls, retained photo/document viewing, saved presentations, and FR/EN
desktop and Chromium 390px touch layouts. Mobile checks are emulation, not a physical
device. Screenshots and JSON reports are written to `FONCIERE_SENSITIVE_OUTPUT`.
No script contacts Production, sends email, or invokes paid AI services.

For the 2026-10-27 campaign, `domain-tests.log` and `repository-tests.log` contain the
pure-test output in the same public evidence directory as the authenticated reports.
Credentials, backups and local status files remain in the private owned stack folder.
