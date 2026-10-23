# Isolated intervention expenses checks

These runners never load repository `.env` files. They require an owned disposable
Supabase stack on literal loopback: API `56131`, PostgreSQL `56132`, mail `56134`,
and application `3184`. Accounts use `@example.invalid`; no Production record is
read or written. Reuse the installed Docker/Colima, Supabase CLI, Node and browser
runtimes; no installation is needed.

Start the existing Colima VM without changing the Docker context or saved config,
then launch the fresh stack:

```sh
colima start --activate=false --save-config=false --ssh-config=false
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY
export SUPABASE_BIN=/path/to/already-installed/supabase
node tests/house-expenses/server-stack.mjs
```

The launcher prints its unique private workdir. Use its status file; never publish
the status or credentials fixture. The seed refuses an existing CRM workspace:

```sh
export HOUSE_EXPENSES_STATUS_FILE=/printed/private/workdir/local-status.json
node tests/house-expenses/server-prepare.mjs
./node_modules/.bin/tsc --outDir /private/tmp/oar-house-expenses-test-compiled --target es2020 --module commonjs --esModuleInterop --skipLibCheck lib/houseTracking.ts lib/monthlyCharges/calculations.ts
node tests/house-expenses/server-tests.mjs
```

The server suite uses real local password Auth sessions and real PostgREST/RPC
writes and rereads. It verifies owner and restricted create/update, the exact
148.60 / 98.60 example, validation and atomic rejection, readonly restrictions,
conflicts, archived workers, legacy rows, Charges projection and CSV. It restores
the fictional source fixture in `finally`; run it before browser mutations.

Build and serve a source-identical copy with a loopback-only network guard:

```sh
export HOUSE_EXPENSES_TEST_ACK=HOUSE_EXPENSES_LOCAL_ONLY
node tests/house-expenses/serve.mjs
```

The private manifest records source hashes, launcher/server process IDs, build
mode and readiness. Browser checks use this production build and the real local
Auth/RPC services. Their network failure scenario is a deliberate simulation;
successful saves and reloads use the actual local database.

In a second terminal with the same local opt-in and status path, run:

```sh
node tests/house-expenses/browser.mjs
```

The browser runner uses installed Chrome with desktop and mobile touch emulation;
override `PLAYWRIGHT_MODULE`
if the Playwright runtime is installed elsewhere. Screenshots, CSVs and results
are saved beside the private local stack, outside Git.

Stop the application launcher, then use the **exact** stop/network commands
printed by `server-stack.mjs`. Do not stop all projects, reset, prune, delete
volumes, or stop any preexisting environment. Keep private fixtures out of Git.
