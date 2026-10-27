import test from "node:test";
import assert from "node:assert/strict";
import { beginPageRefreshOperation, registerPageRefreshGuard, requestPageRefresh, shouldProtectPageUnload } from "../lib/pageRefresh";

test("page refresh protects retained drafts and writes without saving or navigating", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let dirty = false, busy = false, confirmed = true;
  let confirmations = 0, alerts = 0, reloads = 0;
  const release = registerPageRefreshGuard(() => ({ dirty, busy }));
  const options = {
    confirmMessage: "Unsaved changes may be lost", busyMessage: "Wait for the operation",
    confirm: () => { confirmations++; return confirmed; },
    alert: () => { alerts++; },
    reload: () => { reloads++; assert.equal(shouldProtectPageUnload(), false, "no second native confirmation"); }
  };
  try {
    assert.equal(shouldProtectPageUnload(), false);
    assert.equal(requestPageRefresh(options), true);
    assert.equal(reloads, 1);
    assert.equal(confirmations, 0);
    assert.equal(requestPageRefresh(options), false, "repeated click cannot reload twice");
    t.mock.timers.tick(1501);

    dirty = true; confirmed = false;
    assert.equal(shouldProtectPageUnload(), true);
    assert.equal(requestPageRefresh(options), false);
    assert.equal(reloads, 1, "cancel leaves the editor intact");
    assert.equal(dirty, true);
    assert.equal(shouldProtectPageUnload(), true);
    confirmed = true;
    assert.equal(requestPageRefresh(options), true);
    assert.equal(confirmations, 2);
    t.mock.timers.tick(1501);
    assert.equal(shouldProtectPageUnload(), true, "cancelled browser navigation restores protection");

    dirty = false;
    const background = registerPageRefreshGuard(() => ({ dirty: true, busy: false }));
    assert.equal(requestPageRefresh(options), true, "hidden host participates");
    assert.equal(confirmations, 3);
    background(); t.mock.timers.tick(1501);

    busy = true;
    assert.equal(requestPageRefresh(options), false);
    assert.equal(alerts, 1);
    assert.equal(confirmations, 3, "active write never offers destructive confirmation");
    busy = false;
    const finish = beginPageRefreshOperation();
    assert.equal(shouldProtectPageUnload(), true);
    assert.equal(requestPageRefresh(options), false);
    finish(); finish();
    assert.equal(shouldProtectPageUnload(), false, "release is idempotent");

    dirty = true;
    assert.equal(requestPageRefresh({ ...options, confirm: () => { busy = true; return true; } }), false, "write starting during confirmation blocks refresh");
    busy = false; dirty = false;
    assert.throws(() => requestPageRefresh({ ...options, reload: () => { throw new Error("blocked"); } }), /blocked/);
    dirty = true;
    assert.equal(shouldProtectPageUnload(), true, "throw restores guard immediately");
  } finally { release(); t.mock.timers.reset(); }
});
