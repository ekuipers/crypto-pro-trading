// ============================================================
// PRO SETTINGS ACCOUNT SCOPING — regression test for the Suite roadmap bug
// ("Every newly registered account gets the Alpaca Exchange API Keys
// automatically... everyone will trade on the same Alpaca account").
// ------------------------------------------------------------
// Root cause: src/js/api-config.js's browser-only Alpaca credentials
// (localStorage["proDashboardSettings"]) and src/js/autopilot.js's
// autopilotXxx runtime keys were scoped to the BROWSER only, never to WHO is
// signed into it — a second account signing in on the same browser silently
// inherited the first account's keys. reconcileAccountScopedStorage() (added
// 2026-08-07) fixes this by wiping that local-only state whenever the
// signed-in uid differs from the browser's last-known owner.
//
// Transcribed rather than imported, same convention as i18nDomGuard.test.js:
// api-config.js is a classic global script (DOM/localStorage/fetch globals,
// no module system), not something Node can import directly.
// ============================================================
import test from "node:test";
import assert from "node:assert";

function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store),
    _store: store,
  };
}

// Transcribed from api-config.js's reconcileAccountScopedStorage().
async function reconcileAccountScopedStorage(localStorage, fetchImpl) {
  const OWNER_KEY = "proDashboardSettingsOwner";
  let uid = "guest";
  try {
    const r = await fetchImpl("/api/me");
    if (r.ok) {
      const d = await r.json();
      if (d && d.user && d.user.id) uid = d.user.id;
    }
  } catch (e) {
    return;
  }
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner !== null && owner !== uid) {
    localStorage.removeItem("proDashboardSettings");
    localStorage.keys()
      .filter((k) => k.indexOf("autopilot") === 0)
      .forEach((k) => localStorage.removeItem(k));
  }
  localStorage.setItem(OWNER_KEY, uid);
}

const meFetch = (uid) => async () => ({
  ok: true,
  json: async () => (uid ? { user: { id: uid } } : { user: null }),
});

test("a second account signing in on the same browser wipes the first account's local Alpaca keys", async () => {
  const ls = makeLocalStorage({
    proDashboardSettingsOwner: "alice",
    proDashboardSettings: JSON.stringify({ paperApiKey: "PK_ALICE", paperApiSecret: "secret" }),
    autopilotHwm: JSON.stringify({ "BTC/USD": 50000 }),
    autopilotEnabled: "1",
  });
  await reconcileAccountScopedStorage(ls, meFetch("bob"));
  assert.strictEqual(ls.getItem("proDashboardSettings"), null);
  assert.strictEqual(ls.getItem("autopilotHwm"), null);
  assert.strictEqual(ls.getItem("autopilotEnabled"), null);
  assert.strictEqual(ls.getItem("proDashboardSettingsOwner"), "bob");
});

test("signing out (guest) also wipes local Alpaca keys — a shared browser must not leave them for the next visitor", async () => {
  const ls = makeLocalStorage({
    proDashboardSettingsOwner: "alice",
    proDashboardSettings: JSON.stringify({ paperApiKey: "PK_ALICE" }),
  });
  await reconcileAccountScopedStorage(ls, meFetch(null));
  assert.strictEqual(ls.getItem("proDashboardSettings"), null);
  assert.strictEqual(ls.getItem("proDashboardSettingsOwner"), "guest");
});

test("the same account signing back in keeps its own saved keys", async () => {
  const ls = makeLocalStorage({
    proDashboardSettingsOwner: "alice",
    proDashboardSettings: JSON.stringify({ paperApiKey: "PK_ALICE" }),
  });
  await reconcileAccountScopedStorage(ls, meFetch("alice"));
  assert.strictEqual(ls.getItem("proDashboardSettings"), JSON.stringify({ paperApiKey: "PK_ALICE" }));
});

test("no prior owner recorded (upgrade from a version without this check) does not wipe an existing single-user setup", async () => {
  const ls = makeLocalStorage({
    proDashboardSettings: JSON.stringify({ paperApiKey: "PK_EXISTING" }),
  });
  await reconcileAccountScopedStorage(ls, meFetch("alice"));
  assert.strictEqual(ls.getItem("proDashboardSettings"), JSON.stringify({ paperApiKey: "PK_EXISTING" }));
  assert.strictEqual(ls.getItem("proDashboardSettingsOwner"), "alice");
});

test("a network hiccup leaves storage untouched rather than guessing wrong", async () => {
  const ls = makeLocalStorage({
    proDashboardSettingsOwner: "alice",
    proDashboardSettings: JSON.stringify({ paperApiKey: "PK_ALICE" }),
  });
  await reconcileAccountScopedStorage(ls, async () => { throw new Error("network down"); });
  assert.strictEqual(ls.getItem("proDashboardSettings"), JSON.stringify({ paperApiKey: "PK_ALICE" }));
  assert.strictEqual(ls.getItem("proDashboardSettingsOwner"), "alice");
});
