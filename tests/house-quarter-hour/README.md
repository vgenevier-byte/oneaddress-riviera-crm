# Personnel quarter-hour regression

The component test renders the production selector and checks its actual option
values and labels in FR/EN, selected values, and controlled `HH:mm` changes. It
uses the existing TypeScript loader; i18n hook and CSS are supplied for isolated
rendering. It does not provide browser, authentication, or persistence evidence.

```sh
node --test tests/house-quarter-hour/component.test.cjs
node --require ./tests/i18n/register-typescript.cjs --test tests/houseTracking.test.ts tests/houseExpenses.test.ts tests/monthly-charges/calculations.test.ts
```

The browser and server runners use the existing disposable house-expenses stack
and source-identical application harness. See `../house-expenses/README.md` for
the local-only setup and explicit opt-ins. Never publish its private status or
credential fixtures.

After starting a fresh owned stack and running `server-prepare.mjs` as documented
there, use the same explicit status path for these commands:

```sh
export HOUSE_EXPENSES_STATUS_FILE=/absolute/path/to/owned-stack/local-status.json
export IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY
export HOUSE_QUARTER_COMPILED="$(mktemp -d /private/tmp/house-quarter-compiled.XXXXXX)"
./node_modules/.bin/tsc --outDir "$HOUSE_QUARTER_COMPILED" --target es2020 --module commonjs --esModuleInterop --skipLibCheck lib/houseTracking.ts
node tests/house-quarter-hour/server.mjs
HOUSE_EXPENSES_TEST_ACK=HOUSE_EXPENSES_LOCAL_ONLY node tests/house-expenses/serve.mjs
# In another terminal, with the same two exported variables:
node tests/house-quarter-hour/browser.mjs
```

Run the server checks before browser writes. The browser checks cover the real
shared form in both full and restricted access, French and English, at 1440px
and 390px. They assert the exact rendered hour and minute options, native
keyboard selection and focus, touch opening, pause/midnight previews, failed
and pending saves, retained times for a new entry, and fresh password
authentication followed by exact persistence and historical-expense checks.
All successful business writes reach the real isolated RPC/database; failure
checks explicitly abort the relevant request.

The browser runner uses installed Chrome. Mobile checks use Chromium touch
emulation, not a physical phone; WebKit requires a separately installed runtime.
`form-1440-fr.png` and `form-390-fr.png` show the unchanged product interface.
`native-popup-attempt.png` attempts a native keyboard-open capture. Native
desktop menus can fall outside the page screenshot surface, so
`four-minute-choices-fr.png` temporarily sets `size=4` on the same two rendered
minute selects for a diagnostic capture. Its four existing options are
unchanged; `capture-provenance.json` records this capture-only DOM change.
These screenshots are isolated test evidence, not authenticated Production or
physical-device evidence. Private status/auth fixture files must never be
published.
