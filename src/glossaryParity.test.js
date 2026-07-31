// ============================================================
// GLOSSARY PARITY — pins the four glossary sources against each other.
// ------------------------------------------------------------
// The Glossary tab is DB-backed: server.js syncs memory/glossary.md (English,
// section-extracted) and memory/glossary.{nl,fr,es}.md (already serve-ready)
// into one row per language, and /api/glossary?lang= serves them.
//
// The failure this guards is Suite rule 20's: someone adds or renames a term
// in the English glossary and does not touch the other three. Nothing breaks —
// the tab still renders, the build still passes, tests still go green — the
// Dutch reader simply never learns the new term exists. That is invisible
// without a check, and it is the way a translated glossary rots.
//
// The invariant: the **Term column is the key and is identical in all four
// languages**. Terms are the lookup handle (a user sees "ATR" or "Trailing
// stop" in the dashboard and searches for it here), and the abbreviations are
// untranslated by design anyway (Suite rule 22). Only the definition columns
// are translated. That makes drift exactly detectable.
// ============================================================
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractGlossarySections } from "./glossaryExtract.js";
import { glossaryId } from "./db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEMORY = path.join(HERE, "..", "memory");

const SOURCES = { en: "glossary.md", nl: "glossary.nl.md", fr: "glossary.fr.md", es: "glossary.es.md" };
const LANGS = Object.keys(SOURCES);

/** The markdown each language actually serves (English needs section extraction). */
function served(lang) {
  const raw = fs.readFileSync(path.join(MEMORY, SOURCES[lang]), "utf8");
  return lang === "en" ? extractGlossarySections(raw) : raw.trim();
}

/** First column of every data row, in order — the term keys. */
function terms(md) {
  return md
    .split(/\r?\n/)
    .filter((l) => /^\s*\|/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|")[0].trim())
    .filter((t) => t && !/^:?-{2,}:?$/.test(t))
    .filter((t) => !["Term", "Terme", "Término"].includes(t));
}

const byLang = Object.fromEntries(LANGS.map((l) => [l, served(l)]));

test("every language file is present and non-trivial", () => {
  for (const lang of LANGS) {
    assert.ok(byLang[lang].length > 2000, `${SOURCES[lang]} looks truncated (${byLang[lang].length} chars)`);
  }
});

test("all four languages define exactly the same terms, in the same order", () => {
  const base = terms(byLang.en);
  assert.ok(base.length >= 70, `expected the full term set from English, got ${base.length}`);
  for (const lang of LANGS.slice(1)) {
    const got = terms(byLang[lang]);
    const missing = base.filter((t) => !got.includes(t));
    const extra = got.filter((t) => !base.includes(t));
    assert.deepEqual(missing, [], `${SOURCES[lang]} is missing ${missing.length} term(s) present in English — a reader in that language never learns they exist`);
    assert.deepEqual(extra, [], `${SOURCES[lang]} defines ${extra.length} term(s) that English does not`);
    // Order too: the tab renders the table as-is, so a reordered translation
    // would silently pair a term with a neighbouring definition on review.
    assert.deepEqual(got, base, `${SOURCES[lang]} lists the same terms in a different order than English`);
  }
});

test("the two sections survive in every language", () => {
  for (const lang of LANGS) {
    const headings = byLang[lang].split(/\r?\n/).filter((l) => /^##\s+/.test(l));
    assert.equal(headings.length, 2, `${SOURCES[lang]} should serve exactly the two glossary sections, found ${headings.length}`);
  }
});

// Translations are stored verbatim precisely because extractGlossarySections()
// matches the two *English* headings — running a translated file through it
// would yield "" and the tab would silently fall back to English. Pin that so
// nobody "tidies up" server.js by extracting all four.
test("extraction would destroy the translations — which is why it is not applied to them", () => {
  for (const lang of LANGS.slice(1)) {
    const raw = fs.readFileSync(path.join(MEMORY, SOURCES[lang]), "utf8");
    assert.equal(extractGlossarySections(raw), "", `${SOURCES[lang]} unexpectedly matches the English headings — re-check server.js's sync branch`);
  }
});

// The whole reason this shipped without a schema migration: an OLD build cold
// -starting during a deploy window still calls getGlossary()/putGlossary(content)
// with no lang argument, and must keep hitting exactly the row it always did.
// A composite (id, lang) key would have broken both — its `on conflict (id)`
// would have no matching constraint, and its `where id = 'trader'` would start
// matching four rows. Pin the id scheme so that stays true.
test("English keeps the bare legacy row id, so an old build is unaffected", () => {
  assert.equal(glossaryId(), "trader", "a no-arg call is the old signature — it must resolve to the original row");
  assert.equal(glossaryId("en"), "trader");
  assert.equal(glossaryId(null), "trader");
  for (const lang of ["nl", "fr", "es"]) {
    assert.equal(glossaryId(lang), `trader:${lang}`);
    assert.notEqual(glossaryId(lang), "trader", "translations must never collide with the legacy row");
  }
});

// Definitions must actually be translated, not copy-pasted English. Checked on
// a handful of long prose rows rather than every row, since short rows can
// legitimately coincide across languages (proper nouns, formulas, ticker lists).
test("definitions are translated, not duplicated from English", () => {
  const enRows = new Map();
  for (const line of byLang.en.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length >= 2 && cells[1].length > 120) enRows.set(cells[0], cells[1]);
  }
  assert.ok(enRows.size >= 8, `expected several long English definitions to compare, got ${enRows.size}`);
  for (const lang of LANGS.slice(1)) {
    const identical = [];
    for (const line of byLang[lang].split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (enRows.has(cells[0]) && enRows.get(cells[0]) === cells[1]) identical.push(cells[0]);
    }
    assert.deepEqual(identical, [], `${SOURCES[lang]} still carries the English text verbatim for: ${identical.join(", ")}`);
  }
});
