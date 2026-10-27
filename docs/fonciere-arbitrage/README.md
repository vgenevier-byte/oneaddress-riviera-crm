# Foncière — 08 — Arbitrage

Each saved Foncière project has a final section for Vincent and Ann Charlotte.
Their distinct, authenticated CRM account UUIDs are configured in Administration,
using the shared searchable account selector. General administration does not confer
the right to vote for either person. Voting requires access to the project but does
not require project editing, deletion, export or presentation creation rights.

The initial value is **À arbitrer**, with no attributed opinion. Each account saves
only its own choice and optional remark; **Refusé** and **À approfondir** require a
nonblank remark. Server timestamps distinguish saved opinions from edits in progress.
The server computes the common status from opinions on the same dossier:

1. Two approvals: **Validé**.
2. Two refusals: **Refusé**.
3. Either opinion requests further review: **À approfondir**.
4. Otherwise: **À arbitrer**.

An approval/refusal disagreement and missing opinions are displayed separately.
Projects remain available with their documents and history after a refusal. The
project list displays and filters these four common statuses under the existing ACL.

## Version and privacy boundary

Opinions, append-only history, account mapping history, reviewed snapshots and the
principal bank-presentation link are dedicated records in `app_private`. API roles
have no direct table access. Guarded RPCs check the current CRM account and project
access; ordinary readers receive only common status, expected opinions and allowed
bank preparation metadata. Only the current designated Vincent and Ann Charlotte
accounts can receive remarks and detailed opinion history.

Approval fingerprints include all saved business `payload.data`, source document
references, linked agency/person identities, and referenced asset identities,
lifecycle and object versions. A separate monotonic business generation also prevents
changing a dossier and reverting it from resurrecting an old approval. The following
do not invalidate approval: recording an opinion, updating a Drive retry/sync state,
creation retry hashes, timestamps, the general revision alone, and archive state.
Unattached pending/finalized uploads are outside the saved dossier until referenced.

Project consultation captures the fingerprint and revision before and after data
and photo hydration. A concurrent change rejects partial consultation. The form pins
the reviewed fingerprint, preserves an in-progress remark on conflict, and requires
an explicit reload and review before voting on a changed or unknown baseline.
Concurrent opinions serialize on the project without changing its revision or
writing to the Drive outbox. Account replacement increments an account epoch;
previous approvals remain historical and are never transferred to the replacement.

Arbitration remarks never enter project payloads or the presentation mapper.
Consequently they are excluded from project/presentation JSON, import metadata,
PowerPoint text and speaker notes, source document copies and Google Drive copies.
Ordinary project notes remain business data under the existing presentation mapping;
family deliberation belongs in the dedicated arbitration remark fields.

## Persistent bank draft

Double approval records a durable preparation request for the approved snapshot.
The voting interface then attempts preparation through the existing presentation
repository. Permission or preparation failure leaves the common decision saved and
shows an actionable, resumable status. An authorized user can resume preparation.
This requires existing project export plus presentation create/write permissions;
no permissions are added by arbitration or its administration.

A project has one principal presentation link. A serialized reservation and claim
lease prevent concurrent/repeated attempts from creating another presentation; a
saved approval marker recovers a lost finalization response. The mapper uses the
approved immutable snapshot, hydrates its compatible photos/documents and leaves
the resulting presentation in its own **draft** workflow. Financial template defaults
are cleared when they do not represent entered project hypotheses. Missing address,
price, area, acquisition, financing, works or photo information is identified for
completion. No AI service or bank delivery is called.

A prepared or subsequently edited presentation is preserved. A later approved
snapshot shows that an update is needed and offers opening the existing presentation
for deliberate reconciliation; the automation does not overwrite worked content.
Withdrawing/changing an opinion or changing the dossier marks its bank approval as
out of date without deleting the presentation or its versions.

## Targeted verification

The isolated campaign uses newly owned loopback Supabase services, real Auth JWTs,
PostgREST, PostgreSQL and Storage, with exclusively fictitious `@example.invalid`
accounts. Repository production environment files are never loaded. Credential-bearing
status/fixture files stay outside Git and evidence directories.

```sh
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere-arbitrage/bank-mapping.test.ts
npx tsc --noEmit --incremental false
npm run lint
npm run build
git diff --check
```

For the authenticated suites, create an explicitly owned disposable stack following
`docs/izord/local-testing.md` and `tests/prepaid-hours/server-stack.mjs`, then set
`IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`, `ARBITRAGE_STATUS_FILE` to its private
status JSON, and `ARBITRAGE_OUTPUT` to a public evidence directory. Only API
`127.0.0.1:56031`, PostgreSQL `127.0.0.1:56032` and application
`127.0.0.1:3197` are accepted. Apply repository migrations to this isolated stack,
then run `tests/fonciere-arbitrage/prepare.mjs`, `server.mjs` and `bank.mjs`.
The browser launcher `serve.mjs` additionally requires
`ARBITRAGE_TEST_ACK=ARBITRAGE_LOCAL_ONLY` and
`ARBITRAGE_SERVER_ACK=ARBITRAGE_OWNED_LOCAL_ONLY`; run `browser.mjs` with its generated
private `ARBITRAGE_FIXTURE` path. Do not reset or stop a stack owned by another task.

The reviewed evidence currently records 10 authenticated server groups, including
all 16 opinion pairs, and 5 authenticated bank preparation groups. These exercise
privacy, direct RPC denial, reconnection, simultaneous votes, business/document
changes, revoked access, account replacement, no opinion-driven Drive job, exact
approved source data, unchanged worked presentations, and JSON/PowerPoint privacy.
One deliberately lost response is simulated after an actual committed server
finalization. Google/Drive network calls and production business writes are excluded
from these tests. Browser results, final repository checks, screenshots and the exact
release commit/deployment are recorded in the release report after verification.
