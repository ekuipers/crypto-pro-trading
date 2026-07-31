// ============================================================
// I18N DOM GUARD — regression tests for the 2026-07-30 user report
// ("Scheduled Jobs will not load when choosing FR or ES").
// ------------------------------------------------------------
// `applyDomI18n()` (client/src/i18n/index.js) assigns textContent to every
// [data-i18n] node. 30 of those ids are loading/empty placeholders that a tab
// script later replaces with rendered content, so every language switch wrote
// the placeholder back over the content — and since no tab script listened for
// `lang-changed`, nothing re-rendered and the panel stayed blank.
//
// The fix: only write a node while its text still matches what i18n last put
// there. This file pins the three behaviours that has to satisfy at once, so
// nobody "simplifies" the guard away. The logic is transcribed rather than
// imported because index.js is an ES module in the client bundle that pulls in
// react-i18next; the assertions are about the guard, not about i18next.
// ============================================================
import test from "node:test";
import assert from "node:assert";

function makeEl(key, text) {
  return {
    dataset: {},
    textContent: text,
    getAttribute: (k) => (k === "data-i18n" ? key : null),
    // stand-in for a tab script rendering markup into the placeholder
    render(html) { this.textContent = html.replace(/<[^>]*>/g, ""); },
  };
}

// Transcribed from applyDomI18n()'s [data-i18n] branch.
function applyDomI18n(nodes, t) {
  for (const el of nodes) {
    const applied = el.dataset.i18nApplied;
    if (applied !== undefined && el.textContent !== applied) continue;
    const next = t(el.getAttribute("data-i18n"));
    el.textContent = next;
    el.dataset.i18nApplied = next;
  }
}

const EN = { "app:command.jobsLoading": "Loading…", "app:command.jobsTitle": "☁ Scheduled Jobs" };
const FR = { "app:command.jobsLoading": "Chargement…", "app:command.jobsTitle": "☁ Tâches planifiées" };

test("a script-written panel survives a language switch (the reported bug)", () => {
  const list = makeEl("app:command.jobsLoading", "Loading…");
  applyDomI18n([list], (k) => EN[k]);                                  // fragment loads
  list.render("<div>Evaluate OK · 30 Jul, 02:00 GMT+2</div>");         // renderCronJobs()
  applyDomI18n([list], (k) => FR[k]);                                  // user picks FR
  assert.match(list.textContent, /Evaluate OK/, "the rendered schedule must not be wiped");
});

test("ordinary chrome still re-translates on a language switch", () => {
  const title = makeEl("app:command.jobsTitle", "☁ Scheduled Jobs");
  applyDomI18n([title], (k) => EN[k]);
  applyDomI18n([title], (k) => FR[k]);
  assert.strictEqual(title.textContent, "☁ Tâches planifiées");
});

test("a placeholder still translates while the script has not written yet", () => {
  const list = makeEl("app:command.jobsLoading", "Loading…");
  applyDomI18n([list], (k) => EN[k]);
  applyDomI18n([list], (k) => FR[k]);
  assert.strictEqual(list.textContent, "Chargement…");
});

test("the guard survives repeated passes in the same language", () => {
  const title = makeEl("app:command.jobsTitle", "☁ Scheduled Jobs");
  applyDomI18n([title], (k) => EN[k]);
  applyDomI18n([title], (k) => EN[k]);
  applyDomI18n([title], (k) => FR[k]);
  assert.strictEqual(title.textContent, "☁ Tâches planifiées");
});
