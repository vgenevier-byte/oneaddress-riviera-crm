# Arbitrage Foncière — isolated verification

All accounts use `@example.invalid`. The service runners require the explicit
`IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY` acknowledgement and a private
`ARBITRAGE_STATUS_FILE` belonging to a newly created loopback-only Supabase stack.
They never read repository `.env` files, contact Production, send messages, invoke
AI, or copy anything to Google Drive.

Use the installed Colima/Supabase runtime and the existing
`tests/prepaid-hours/server-stack.mjs` launcher. It creates an owned stack on API
`127.0.0.1:56031`, PostgreSQL `127.0.0.1:56032`, and local mail `56034`.
An occupied port must fail; never stop or reset another stack.

The private status file and generated `arbitrage-fixture.private.json` contain
local credentials. Keep both outside Git and the public evidence directory.
Set `ARBITRAGE_OUTPUT` to the directory receiving sanitized reports and captures.
Run from the repository root:

```sh
node tests/fonciere-arbitrage/prepare.mjs
node tests/fonciere-arbitrage/server.mjs
node tests/fonciere-arbitrage/bank.mjs
node tests/fonciere-arbitrage/supplemental.mjs
node tests/fonciere-arbitrage/final-schema-rollback.mjs
```

`prepare.mjs` requires a fresh disposable database. Its optional
`ARBITRAGE_RESUME=1` recovers only an incomplete owned setup with no projects and
only `arbitrage-…@example.invalid` accounts. It does not reset data.
The bank and supplemental campaigns create additional fictional projects to keep
recovery scenarios independent. The server campaign's initial-state assertions are
intended to run once against the freshly prepared fixture.

The server campaign exercises all 16 choices, blank remarks, genuine authenticated
account mapping, direct impersonation denials, contributor and admin denials,
private response projection/table grants, fresh authentication, simultaneous
opinions, business/document conflicts, account replacement, current-JWT access
revocation, and the absence of project/Drive writes caused by opinions.
The bank campaign uses real Storage copies and ordinary generator writes. It
simulates exactly one network response lost **after** successful real finalization;
the underlying draft and durable link are real server records. It verifies exact
approved data despite a later source edit, retry uniqueness, preservation of worked
presentations, withdrawal, JSON privacy, and speaker-note generation.
The supplemental campaign verifies tab/newline-only remarks, edit-and-revert
invalidation, changes during actual repository hydration, and preservation of an
edited reserved presentation shell. Its optional `ARBITRAGE_PATCH` argument is only
for a reviewed CREATE OR REPLACE patch during local development; final runs need no
patch when the current migration is installed.

For the source-identical application, set:

- `ARBITRAGE_TEST_ACK=ARBITRAGE_LOCAL_ONLY`
- `ARBITRAGE_SERVER_ACK=ARBITRAGE_OWNED_LOCAL_ONLY`
- `ARBITRAGE_STATUS_FILE` to the same private stack status file.

```sh
node tests/fonciere-arbitrage/serve.mjs
```

The launcher copies sources without `.env` files, injects only the owned local
credentials, restricts network egress to loopback, builds, then starts the actual
production server at `127.0.0.1:3197`. `--dev` is available for repair iterations.
Its private manifest records source SHA-256 values; compare these with final
sources before reporting browser coverage.

Set `ARBITRAGE_FIXTURE` to the private fixture JSON and run:

```sh
node tests/fonciere-arbitrage/browser.mjs
```

The browser uses real password Auth and the application/RPCs, with no mocked success
responses. It covers Administration account selection, saved versus unsaved votes,
required remarks, reload/re-authentication, a real concurrent source edit while a
remark is being composed, explicit re-reading, keyboard radio navigation, ordinary
contributor privacy, and the four-status list filter. It downloads actual JSON and
PowerPoint files, opens the ZIP, and scans every XML/rels entry including slide
notes and document metadata for a private marker.
FR desktop and EN 390px touch screenshots use fictional data. Mobile is Chromium
emulation, not a physical device. Optional `ARBITRAGE_BROWSER_ONLY` selects repair
scenarios; final evidence should come from a full run without this filter.
