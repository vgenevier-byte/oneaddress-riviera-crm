# Supplier quote informational status verification

This bench uses a dedicated local Supabase stack (Auth, PostgreSQL, PostgREST, Storage), synthetic `@example.invalid` accounts, and a source-identical CRM copy. The application and browser refuse network destinations outside the bench. It never loads the repository environment.

1. Start `server-stack.mjs` with `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`, `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`, and `SUPABASE_BIN` set to an installed CLI. It prints its private temporary directory and cleanup commands.
2. Set `VENDOR_INFORMATION_STATUS_FILE` to the returned `local-status.json`. Keep `IZORD_TEST_ACK` for server tests. Run `prepare.mjs` to install historical migrations and synthetic profiles, then `apply.mjs` to install the new migration and check complete payload equality.
3. Run `server.mjs`. It exercises real Auth login/logout, quote creation, uploads, persistence, transitions, invoice-link protections, permission boundaries, concurrent requests, manual-task retention, and idempotent validation. It restores only its owned synthetic payload for UI tests. `--reset` permits rerunning against that same synthetic baseline.
4. Start `serve.mjs --dev` with `VENDOR_INFORMATION_TEST_ACK=VENDOR_INFORMATION_LOCAL_ONLY`. The server runs on `127.0.0.1:3207` and copies only application sources/configuration, excluding `.env` files. Run `browser.mjs` with the server test environment for FR/EN desktop/mobile full/restricted scenarios and screenshots.

Run `approval.browser.mjs` after `browser.mjs` to exercise the existing full UI confirmation and invoice creation on the persisted `DEMO-UI-FULL` synthetic quote. `VENDOR_INFORMATION_APPROVAL_REFERENCE` can select another existing synthetic quote. `recapture.mjs` refreshes screenshots and source hashes after a layout-only adjustment; it restores only the pending/refused fixture quotes through the dedicated guarded RPC.

Evidence is written under `docs/vendor-information/`. Private users, passwords, keys and session data remain in the temporary stack directory and are never copied into repository evidence. Stop the app launcher, then use the exact stack stop and network removal commands printed at startup. Do not stop unrelated stacks.

`apply.mjs --replace-local-functions` is a loopback-only development helper for replaying revised uncommitted function definitions; it is not the production migration procedure.
