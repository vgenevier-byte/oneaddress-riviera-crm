# Distributed vendor folders

The upload route uses `crm_drive_folder_registry`, independently of the CRM JSON payload. The registry contains technical identifiers only. No bank details or supplier names are stored there.

## Deployment prerequisites (not applied by this change)

1. Review and apply `supabase/migrations/20260914210807_drive_folder_registry.sql` in a separately authorized release.
2. Reuse the existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The route validates the incoming Bearer with `auth.getUser(token)`, checks contact access under that user’s RLS, then passes the same Authorization header to the private registry RPC client. No new privileged credential is required.
3. Set `GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID` to the existing folder 03 ID. Keep the current OIDC/WIF configuration and service account.

No live migration, credentials change or deployment is performed by adding these files. An unavailable registry fails closed; there is no fallback to name-based creation or a memory lock.

## Invariants

- Primary key: `(workspace_id, logical_key)`. Keys use the URL-encoded contact ID, not the supplier name: `vendor:<contactId>` and `vendor:<contactId>:rib`. Ordinary UUIDs are unchanged by encoding.
- Claim uses `INSERT ... ON CONFLICT`, a row lock and an explicit token/expiry compare-and-swap. Postgres time defines a 30-second lease. A waiting worker polls briefly, with a bounded 45-second resolution budget; timeout returns 503 and can be retried.
- Only a claimant can reserve an ID or mark the row ready. Old lease tokens are fenced out. Parent and any non-null reserved Drive ID are immutable. Ready rows cannot return to creating. Do not purge this registry.
- Before creating a folder, the server searches by parent, Shared Drive and all five private appProperties: `workspaceId`, `managedBy=crm`, `entityType=vendor`, `entityId=<contactId>`, `folderKind=vendor-root|rib`.
- Once reserved, the ID is never regenerated. If ID generation succeeded but no reservation was committed, that unused ID cannot have been used to create a folder; another claim may generate an unused replacement safely.
- No Drive POST occurs before acknowledgement of the committed reservation. Lost reservation acknowledgement aborts that attempt. The next claimant reads the committed ID.
- Drive POST includes the reserved ID. A timeout, 409 or delayed old worker cannot create a second folder with another ID. GET must confirm exact ID, MIME, Shared Drive, parent, appProperties and `trashed=false` before ready is committed.
- A crash after creation but before ready is recovered through GET of the reserved ID. Recovery without a reservation uses appProperties, never a name-only match. Conflicts, moved/trashed folders and multiple recovery matches fail explicitly rather than silently replacing a folder.
- The table has RLS and no policies. All direct table privileges are revoked from PUBLIC, anon and authenticated. Only authenticated has EXECUTE on the three SECURITY DEFINER RPCs: `crm_drive_folder_claim`, `crm_drive_folder_reserve`, `crm_drive_folder_ready`. Each checks `auth.uid()` and fixes `search_path=pg_catalog`; every table reference is explicitly qualified. There is no dynamic SQL or access to any other table.
- Each RPC rejects any workspace except `oneaddress-riviera` and any key outside `vendor:<encodedContactId>` or `vendor:<encodedContactId>:rib`, with a 500-character maximum. A contact token consists of encodeURIComponent-safe characters or uppercase `%HH` triplets; raw colons occur only in the prefix and optional `:rib` suffix. UUIDs remain unchanged. Matching constraints also protect the table.
- Claim/reserve return only workspace/key/parent/Drive ID/status, plus `claimed` for claim; ready returns a boolean. Lease tokens and timestamps never leave the database through RPC results. The guard trigger is SECURITY INVOKER, has the same fixed search path and no client EXECUTE grant; it only checks OLD/NEW invariants.
- All Drive route modules and `lib/server/driveRegistrySupabase.ts` carry `import "server-only"`. The RPC wrapper exposes only claim/reserve/ready and disables session persistence and refresh. UI code only calls the authenticated upload route, never registry RPCs.
- RPC errors are replaced by a generic 503; missing configuration uses a generic 500 without environment names. Absent/invalid JWT stops with 401. The first claim must succeed before ID generation, and reserve must be acknowledged before any Drive POST. There is no Storage fallback.

Granting EXECUTE to authenticated makes these narrow RPCs callable with a valid user JWT outside the UI too. Their SQL checks are the authorization boundary. They cannot query or mutate CRM business data. The single-workspace model checks an authenticated subject, not membership in another table, as requested.

The fixed search path and explicit EXECUTE grants follow [Supabase database function guidance](https://supabase.com/docs/guides/database/functions). The server-only boundary follows [Next.js environment isolation guidance](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).

The Google Drive guarantee for pre-generated folder IDs and repeated create requests returning 409 is documented at [Create and manage files](https://developers.google.com/workspace/drive/api/guides/create-file#generate_ids_to_use_with_your_files).

## Local concurrency tests

`tests/driveFolderConcurrency.test.ts` executes the versioned SQL against actual PostgreSQL using independent connections, with Drive entirely simulated. It requires a **fresh, disposable** local database named `oar_folder_registry_test`, owned by the test user, and the test-only `pg` module on NODE_PATH. The host guard refuses non-loopback database URLs. Without `OAR_TEST_DATABASE_URL`, this suite is explicitly skipped; it is never replaced by an in-memory proof of distributed safety.

This change was tested with PostgreSQL 18.4 from `embedded-postgres@18.4.0-beta.17` and `pg@8.16.3`, installed under a temporary directory, outside application dependencies. The application adds only `server-only@0.0.1` for its server boundary; Node tests use its official `react-server` condition. Create the disposable cluster before the commands below; never point them at a live Supabase database.

```sh
npx tsc --outDir /tmp/oar-folder-tests --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck tests/*.test.ts
NODE_PATH="$PWD/node_modules:/tmp/oar-postgres-test-runtime/node_modules" \
OAR_TEST_DATABASE_URL='postgresql://<test-user>:<test-password>@127.0.0.1:<test-port>/oar_folder_registry_test' \
node --conditions=react-server --test /tmp/oar-folder-tests/tests/*.test.js
```

Coverage includes 20 concurrent vendor claims, 20 RIB claims, 20 complete vendor→RIB resolutions, competing lease takeovers, late old workers, Drive timeouts/409, crashes before/after Drive creation, lost RPC responses, recovery validation and direct table permission rejection, anonymous RPC rejection, authenticated RPC success, missing subject/workspace/key rejection, minimal outputs and an unchanged local business-table sentinel. HTTP tests additionally prove JWT forwarding and fail-closed behavior with mocked external services.
