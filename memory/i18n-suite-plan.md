# Multi-language support (EN/NL/FR/ES) — Suite roadmap item 0

Full-suite implementation plan, produced 2026-07-24 by a planning pass across all 5 CryptoPro
repos (Suite, Trader, Charts, Training, Mobile) before any code was written. Kept here (Trader's
`memory/`) since Trader is the pattern-establishing project (Phase 0); cross-reference from the
other 4 repos' memory files rather than duplicating this document.

Scope confirmed by the user: translate UI chrome across ALL projects, AND fully translate
Training's entire course content (67 modules, quizzes, calculators) into Dutch/French/Spanish —
AI-translated now, not scaffolded placeholders.

## Architecture findings (verified against the actual repos, not assumed from CLAUDE.md text)

The suite-wide "React front-end + Node backend" rule undersells how much UI text lives outside
JSX. Three distinct buckets, each needing a different extraction approach:

| Project | Architecture | Text surface |
|---|---|---|
| Mobile | Pure React + Vite (a web app despite the name — no React Native/Expo) | 100% JSX |
| Trader | React shell (`client/`) + 37 classic-global `src/js/*.js` files, DOM injection | ~90% vanilla, not JSX |
| Training | Same hybrid; `course.js` (1004 lines) holds the entire course | Chrome mixed; content in one vanilla file |
| Charts | No React shell at all — `public/index.html` + 28 vanilla `src/js/*.js` | 100% vanilla |
| Suite | Static `docs/index.html` + 4 tiny vanilla chrome files | Mostly static HTML |

No existing i18n framework anywhere (no `i18next`/`react-i18next`/`react-intl` in any `package.json`
at planning time).

## Library choice

`i18next` core in every app (single source of truth), `react-i18next` as a thin binding only where
React actually renders text:
- A pure `react-i18next` hook approach only reaches JSX — would miss ~90% of Trader/Charts text.
- Expose a plain `window.t()` (wraps `i18next.t()`) for the classic-global vanilla scripts, which
  load after the React bundle and can't `import` it (see Trader's `scriptLoader.js` `SCRIPT_ORDER`).
- For raw-HTML fragments rendered via `dangerouslySetInnerHTML` (Trader/Training's tab and modal
  HTML) and Suite's fully static `docs/index.html`: a `data-i18n="key"` attribute convention + a
  generic `applyDomI18n(root)` walker (also supports `data-i18n-html` for markup with inline tags,
  `data-i18n-placeholder`, `data-i18n-title`) — one mechanism covers both cases.
- Mobile is the only clean full-React case: `react-i18next` + `useTranslation()` throughout.
- Charts has no bundler for its client — needs the i18next UMD/global build loaded via `<script>`
  tag (vendored locally, no CDN — same precedent as `qrcode-lib.js`), not an ESM `import`.

## File layout & namespacing

No shared npm package — this suite deliberately copies shared files file-for-file across repos
(e.g. `auth.js`, `manual.js`, `terms-modal.js`) rather than sharing packages, to keep each project
independently deployable on Vercel. i18n follows the same "ported identically" convention:

```
src/i18n/                      (or client/src/i18n/ for the React-shell apps)
  index.js                     // i18next init, window.t, applyDomI18n, setDashLang
  locales/
    common/{en,nl,fr,es}.json  // shared chrome — auth, manual, terms, header, footer
                                // — translate ONCE, copy the folder + index.js identically
    app/{en,nl,fr,es}.json      // per-project screens (added per phase, not all at once)
```

Training additionally gets `src/i18n/course/{en,nl,fr,es}.js` — see below.

Key naming: dot-namespaced, semantic, camelCase leaf (`header.dailyJournal`, `footer.disclaimer`,
`modals.trade.submit`).

## Training course content — the largest single piece of work

File: `CryptoPro Training/src/js/course.js`, single file, 1004 lines.
- `COURSE` (lines 2-688): 9 tracks, ~65-67 modules, each with `t`/`d`/`lvl`/optional `viz` (inline
  SVG)/`concept`/`example`/`exercise`/`quiz:{q,a[4],correct,fb}`. 18 modules embed calculators
  (`tool:"position"|"rr"|"liq"`).
- `GLOSSARY` (690-722): 30 term/definition pairs.
- `TRACK_ICON`/`TRACK_META` (channel names, YouTube search seeds) — **do not translate**.
- `LEVEL_NAMES`/`LEVEL_DESC` — translate.
- Rendering code (757-1004) — chrome strings, translate via the same pattern as everywhere else.

Estimate: ~20,000 words English content → ~60,000 words total across NL+FR+ES. **Not a single
file-write.** Storage: refactor into parallel `src/i18n/course/{en,nl,fr,es}.js` files, identical
array shape/order, with `tool`/`lvl`/`correct`/`viz` fields kept structurally identical (copied
verbatim, not re-typed by a translation pass) to avoid corrupting quiz answer indices or SVG
markup. Renderer picks the active-language array, falls back to `en` per-field if missing.

Chunking: 9 tracks × 3 languages = 27 translation passes, each ~7-8 modules — a reviewable,
commit-sized unit. Glossary + `LEVEL_NAMES`/`LEVEL_DESC` is a 28th small pass per language.

## Language persistence

Follows the existing settings-sync precedent exactly (Trader's `src/js/settings-sync.js`,
Charts' `persistence.js`): add `"dashLang"` to `SETTINGS_SYNC_KEYS`, which already round-trips
through `/api/session` (server-wins, same account across devices) — no new sync code needed,
just the one array entry.

## Build order

1. **Trader (this repo) — pattern-establishing.** Hardest mixed case (React shell + heavy
   vanilla). Produces the reusable `i18n/index.js` + `window.t` + `common` namespace that every
   other app copies.
2. **Charts + Suite + Mobile — port the `common` block + switcher identically** (parallelizable;
   each has its own mechanism quirk — Charts' UMD load, Suite's `data-i18n` on static HTML,
   Mobile's full react-i18next).
3. **Training — chrome + `course.js` refactor** (structural split, EN-only first, no visible
   change) **then** the 27-pass content translation (Phase 3).

## Known risks

1. `react-i18next`-only would silently miss most Trader/Charts text — mitigated by the
   `window.t`/`applyDomI18n` dual mechanism.
2. Charts has no bundler — needs the UMD build, not an ESM import.
3. Suite's landing page is static HTML with baked copy — different hook mechanism (`data-i18n`
   attribute pass + boot script) than the other four apps.
4. Shared-chrome files (`auth.js`, `manual.js`, `terms-modal.js`) are duplicated per-repo — if the
   `common` locale block drifts between copies, translations diverge. Translate once, port the
   exact same JSON + source file everywhere.
5. `course.js` quiz-integrity hazard — `quiz.correct` is a numeric index, `viz` is literal SVG.
   Keep those fields structural/verbatim; translators touch text fields only.
6. ~60k words of course translation cannot be one continuous write — the 27-pass chunking is
   mandatory, not optional.
7. No client-side test coverage exists for any of these apps' string layer — i18n extraction
   won't be caught by CI. A lightweight key-completeness check (every key present in all 4
   locales) is worth adding as a guardrail; manual/Playwright browser verification is the other
   check, per this codebase's repeated "browser click-through not yet verified" caveat elsewhere.

## Status

- **Phase 0 (Trader) — done, 2026-07-24.** `i18n/index.js` + `common` namespace (header,
  footer, nav, trade/journal/manual/terms modals) shipped and Playwright-verified (NL switch
  confirmed working, no console errors).
- **Phase 0b (Trader) — done, 2026-07-25.** New `app` namespace
  (`client/src/i18n/locales/app/{en,nl,fr,es}.json`, 550 keys/language, verified identical key
  sets across all 4) covers the 13 tab HTML fragments' subnav/section/panel/chart titles, period
  and filter buttons, every table column header + tooltip, and loading/empty-state placeholders,
  plus `auth.js`'s modals and `manual.js`'s 8 section titles (both converted to call `window.t()`
  at render time rather than baking translated strings at module-load time, so they reflect the
  currently active language). `applyDomI18n()` gained a `data-i18n-tip` handler for the custom
  tooltip system (`ui-helpers.js` reads `el.dataset.tip` live on hover). Deliberately deferred:
  long free-form explanatory paragraphs (lower priority than mechanical UI labels), two spots with
  a live-updated DOM span (`markov.html`'s `#mkThreshLabel`, `port-overview.html`'s
  `#portPosCount`) where translating the surrounding template would clobber the JS-set value on a
  language switch, and `manual.js`'s section body prose (titles only, per scope). Verified: client
  build (84 modules), full backend test suite (310/310), and a Playwright pass confirming NL
  renders correctly across Command/Analytics/Signals/Settings including the new tooltip mechanism.
  Full detail: Trader `CLAUDE.md`'s Dashboard section and `memory/memory.md`'s 2026-07-25 entry.
- Phases 1-3 (Charts/Suite/Mobile port, Training chrome + content): not started.
