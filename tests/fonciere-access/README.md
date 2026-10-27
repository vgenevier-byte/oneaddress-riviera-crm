Foncière / Project Presentations permission separation
====================================================

These tests refuse remote API/database endpoints and never read repository environment files.
All identities are `@example.invalid`. Auth, PostgREST, RPC, PostgreSQL and private Storage
are real services in one explicitly owned disposable local Supabase stack. No email is sent,
no paid AI call is made, and production is never contacted.

Reuse the installed Docker/Colima, Supabase CLI, Node and Chrome runtimes. The existing
`tests/prepaid-hours/server-stack.mjs` launcher provides the owned loopback stack on
API56031 / PostgreSQL56032 / mail56034; its unrelated historical name is only a test
infrastructure wrapper. Do not stop or reset preexisting stacks.

Set `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`, `FONCIERE_ACCESS_STATUS_FILE` to the newly
created stack's private `local-status.json`, `FONCIERE_ACCESS_OUTPUT` to a report directory,
and `FONCIERE_ACCESS_MIGRATION=20261027124814_fonciere_module_permissions.sql`.

Run in order:

```sh
node tests/fonciere-access/prepare.mjs
node tests/fonciere-access/migration.mjs
node tests/fonciere-access/server.mjs
node --test tests/fonciere-access/registry.test.cjs
```

`prepare.mjs` installs every historical migration except the split, creates21 fictional
accounts and pending legacy invitations, saves historical projects/presentations and a
real private PDF, and takes private source/permission backups. `migration.mjs` replays the
complete final SQL once and compares effective Auth-visible records, read/write decisions,
roles, assignments, assets, historical administrator access and all other module grants.
The migration itself must also pass its transaction-wide before/after recovery journal.

`server.mjs` checks the four independent module combinations; read/contribute ceilings;
roles and assignments; direct RPC/RLS/Storage denial; admin save and reconnect; the old
seven-argument administration caller; native-assignment revision invalidation and no-op;
task targets; Contacts independence; existing presentation snapshots after source removal;
and actual local invitation prepare/accept including historical null-role recipients.

Use `tests/prepaid-hours/serve.mjs` without `--dev` to build and serve a source-identical
copy with loopback-only network access. Set its `PREPAID_HOURS_STATUS_FILE` to this same
owned status file and `PREPAID_HOURS_TEST_ACK=PREPAID_HOURS_LOCAL_ONLY`. Then set
`FONCIERE_ACCESS_FIXTURE` to the stack's private `fonciere-access-fixture.private.json` and run:

```sh
node tests/fonciere-access/browser.mjs
```

Browser success responses are never mocked. The real UI saves a fictional account's
module permission and project assignment, reconnects, checks independent navigation,
native Projects mounting, direct-route denial, read-only roles, revocation refresh,
Contacts creation/return, and FR/EN Administration at desktop and Chromium touch390px.
Mobile is emulation, not a physical device. Source hashes must match the final served
copy before publication. `FONCIERE_ACCESS_BROWSER_ONLY` can limit a repair rerun to named
affected scenarios; the final full run should pass without that option.

All credentials/backups remain in the private owned stack directory, outside Git and
public evidence. Stop only the application launcher and stack created for this run,
using the exact stack/network names printed by the launcher. Retain its volume backup.
