Personnel expense summary regression
====================================

Run from the clean source worktree. These integration scripts reuse only an explicitly selected disposable local prepaid stack, verify that every Auth identity uses `@example.invalid`, and reject non-loopback targets. Repository environment files are never loaded.

Set `PREPAID_HOURS_STATUS_FILE` to the disposable `tests/prepaid-hours` stack's `local-status.json`; set `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`. The stack must already have the current prepaid and expense migrations and the `owner`, `contributor`, `reader`, and `none` fictional users. `prepare.mjs` appends fourteen dedicated fictional interventions while retaining existing sources, history, settings and packages. It writes a private pre-suite backup beside the stack status.

Run in order:

```sh
node tests/personnel-expenses/prepare.mjs
node tests/personnel-expenses/server.mjs
PREPAID_HOURS_TEST_ACK=PREPAID_HOURS_LOCAL_ONLY node tests/prepaid-hours/serve.mjs --dev
# In another shell with the same environment, after the server reports ready:
node tests/personnel-expenses/browser.mjs
node tests/personnel-expenses/verify-preservation.mjs
```

The isolated server copy listens at `http://127.0.0.1:3197`, reaches only the disposable Auth/RPC service at `127.0.0.1:56031`, and does not use the checkout's `.next` directory. Stop its launcher after verification. Stop only a disposable stack started for this run; retain its volume.

Compile/run the domain tests without installing dependencies:

```sh
node node_modules/typescript/bin/tsc --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck --outDir /private/tmp/personnel-expenses-domain tests/personnel-expenses/summary.test.ts
node --test /private/tmp/personnel-expenses-domain/tests/personnel-expenses/summary.test.js
```

Coverage: exact cent arithmetic and no mutation; all ten Clément October interventions with expenses in rows one/eight/ten; worker/date/house and inclusive bounds; historical `04/10/2026` date; clear zero state; FR/EN CSV parity; existing owner and contributor RPC edit, save and reload; reader/no-access/anonymous permissions; retained filters; preserved history editor; mobile touch emulation at 390px; draft retained during language change. Server tests also reject stale revisions. Browser and API tests use real local Auth/PostgREST/PostgreSQL, without intercepted success responses.

The verification script compares the actually served source hashes with the final source (including the new component and CSS), checks all unrelated records/payments/history and prepaid settings/packages/allocations/summaries for equality, then restores the exact pre-suite business payload. Results, CSV and desktop/mobile screenshots default to `/private/tmp/personnel-expenses-checks`; override with `PERSONNEL_EXPENSE_OUTPUT`. No production data or authenticated production session is used.
