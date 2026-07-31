// ============================================================
// I18N RUNTIME KEYS — pins roadmap item 8 (closed 2026-07-31).
// ------------------------------------------------------------
// The 13 `src/js/tabs-*.js` dashboard scripts used to render English in every
// language: `applyDomI18n()` only reaches markup carrying a data-i18n*
// attribute, so everything the scripts wrote at runtime — table bodies, KPI
// tiles, status text, tooltips — stayed English and, worse, overwrote the
// translated placeholders underneath it.
//
// They now translate through utils.js's `tt(ns, key, fallback)`. Two things
// can silently undo that, and neither shows up as a failing build:
//
//   1. A `tt()` call whose key is not in the locale file. `tt()` is designed
//      to fall back to the English literal so a missing locale degrades to
//      readable text rather than a raw key — which means a typo'd key looks
//      exactly like working code and renders English forever.
//   2. A key added to en.json but not to nl/fr/es.json. i18next falls back to
//      `en`, so again: English, silently, only in the other three languages.
//
// This file fails on both. It is deliberately source-scanning rather than
// behavioural: the tab scripts are classic <script> globals that need a DOM and
// a live Alpaca session to execute, but the key/locale contract is static.
// ============================================================
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_DIR = path.join(HERE, "..", "client", "src", "i18n", "locales", "app");
const JS_DIR = path.join(HERE, "js");
const LANGS = ["en", "nl", "fr", "es"];

const locales = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${l}.json`), "utf8"))])
);

function flatten(obj, prefix = "") {
  let out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out = out.concat(flatten(v, key));
    else out.push(key);
  }
  return out;
}

const jsSources = fs
  .readdirSync(JS_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => [f, fs.readFileSync(path.join(JS_DIR, f), "utf8")]);

test("every language defines exactly the same keys", () => {
  const base = flatten(locales.en).sort();
  for (const lang of LANGS.slice(1)) {
    const keys = flatten(locales[lang]).sort();
    const missing = base.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !base.includes(k));
    assert.deepEqual(missing, [], `${lang}.json is missing ${missing.length} key(s) — they would silently render English`);
    assert.deepEqual(extra, [], `${lang}.json has ${extra.length} key(s) absent from en.json`);
  }
});

test("every literal tt(ns, key) call resolves to a locale entry", () => {
  const unresolved = [];
  for (const [file, src] of jsSources) {
    // Only literal-key calls; computed keys are covered by the next test. The
    // trailing [,)] matters: without it, `tt("vocab", "regime" + cap(v))` matches
    // as the key "regime" and reports a false failure.
    for (const m of src.matchAll(/\btt\(\s*"([a-zA-Z]+)"\s*,\s*"([a-zA-Z0-9_]+)"\s*[,)]/g)) {
      const [, ns, key] = m;
      if (!locales.en[ns] || !(key in locales.en[ns])) unresolved.push(`${file}: ${ns}.${key}`);
    }
  }
  assert.deepEqual(unresolved, [], `tt() calls with no locale entry (they render the English fallback forever):\n${unresolved.join("\n")}`);
});

// The handful of call sites that build a key from a runtime value. Each maps a
// closed set of engine/DOM values onto a key, so the whole domain is checkable
// — and these are the ones a reader is most likely to assume are fine.
test("computed tt() keys resolve across their full value domain", () => {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const expected = [
    // utils.js ttRegime / ttTrendWord — values emitted by ta-lib.js + the engine
    ...["uptrend", "downtrend", "mixed"].map((v) => ["vocab", "regime" + cap(v)]),
    ...["rising", "falling", "flat"].map((v) => ["vocab", "trend" + cap(v)]),
    // utils.js ttAdxLabel — every branch of adxLabel()
    ...["adxNa", "adxStrong", "adxTrending", "adxEmerging", "adxRanging"].map((k) => ["vocab", k]),
    // tabs-markov.js mkState() — indexes MK_STATES
    ...["Up", "Flat", "Down"].map((v) => ["markov", "rtState" + v]),
    // tabs-signals.js renderNotifStatus() — the Notification API permission domain
    ...["granted", "denied", "default"].map((v) => ["signals", "rtNotifPerm" + cap(v)]),
    // tabs-backtest-settings.js — health is RED/ORANGE/GREEN
    ...["RED", "ORANGE", "GREEN"].map((h) => ["backtest", "rtHealth" + h[0] + h.slice(1).toLowerCase()]),
    // tabs-gapgo.js ggRating() — every rating ggAnalyze() can produce
    ...["Strong", "Moderate", "Weak", "High", "Medium", "Low", "Very High",
        "Mega", "Large", "Mid", "Small", "Unknown", "bullish", "bearish", "mixed"]
      .map((v) => ["gapgo", "rating" + v.replace(/[^A-Za-z]/g, "")]),
    ...["Up", "Down"].map((v) => ["gapgo", "dir" + v]),
  ];
  const missing = expected.filter(([ns, key]) => !locales.en[ns] || !(key in locales.en[ns]));
  assert.deepEqual(missing, [], `computed keys with no locale entry: ${missing.map((m) => m.join(".")).join(", ")}`);
});

// tabs-gapgo.js is the one script that stores i18n keys in its analysis object
// (so ggRenderCards can re-render on `lang-changed` without re-fetching six
// months of bars). Those keys never appear next to a `tt("gapgo", ...)` literal,
// so the scan above cannot see them.
test("tabs-gapgo.js indirect plan/signal keys resolve", () => {
  const src = fs.readFileSync(path.join(JS_DIR, "tabs-gapgo.js"), "utf8");
  const keys = new Set();
  for (const m of src.matchAll(/\{\s*k:\s*"([a-zA-Z0-9]+)"/g)) keys.add(m[1]);       // signals.push({ k: ... })
  for (const m of src.matchAll(/(?:strategyKey|entryKey|sizingKey|riskNoteKey|catalystNoteKey)\s*=\s*([^;]+);/g)) {
    for (const lit of m[1].matchAll(/"([a-zA-Z0-9]+)"/g)) {
      // Skip the comparison operands ("Strong", "Small") — only the ternary
      // results are keys, and every real key here is lowerCamelCase.
      if (/^[a-z]/.test(lit[1])) keys.add(lit[1]);
    }
  }
  assert.ok(keys.size >= 30, `expected the full signal/plan key set, found ${keys.size}`);
  const missing = [...keys].filter((k) => !(k in locales.en.gapgo));
  assert.deepEqual(missing, [], `gapgo keys stored in the analysis object but absent from the locales: ${missing.join(", ")}`);
});

// The regression this whole item is about: a tab script rendering a hardcoded
// English placeholder over a translated one. Catching every English literal is
// not tractable, but the specific strings that were reported are.
test("no tab script still hardcodes the reported placeholder strings", () => {
  const banned = [
    "Configure API credentials in Settings first.",
    "Scanning all symbols…",
    "Error fetching bars — check API credentials.",
  ];
  const offenders = [];
  for (const [file, src] of jsSources) {
    if (!file.startsWith("tabs-")) continue;
    for (const phrase of banned) {
      // A bare literal is a bug; the same text as a tt() fallback is correct.
      for (const m of src.matchAll(new RegExp(`["'\`]${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`, "g"))) {
        const before = src.slice(Math.max(0, m.index - 120), m.index);
        if (!/\btt\(\s*"[a-zA-Z]+"\s*,\s*"[a-zA-Z0-9_]+"\s*,\s*$/.test(before)) {
          offenders.push(`${file}: ${phrase}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `hardcoded English placeholder(s) outside a tt() fallback:\n${offenders.join("\n")}`);
});

// Suite rule 22 records what is untranslated *by design*. Pin it so the
// decision stays visible instead of looking like the next thing to "fix".
test("action codes stay identical in every language (Suite rule 22)", () => {
  for (const key of ["pillBuy", "pillHalf", "pillBear", "pillHold", "crossGolden", "crossDeath"]) {
    const values = LANGS.map((l) => locales[l].vocab[key]);
    assert.equal(new Set(values).size, 1, `vocab.${key} should be untranslated on every platform, got ${JSON.stringify(values)}`);
  }
});
