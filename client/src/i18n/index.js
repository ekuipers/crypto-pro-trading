import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/common/en.json';
import commonNl from './locales/common/nl.json';
import commonFr from './locales/common/fr.json';
import commonEs from './locales/common/es.json';
import appEn from './locales/app/en.json';
import appNl from './locales/app/nl.json';
import appFr from './locales/app/fr.json';
import appEs from './locales/app/es.json';

export const SUPPORTED_LANGUAGES = ['en', 'nl', 'fr', 'es'];
const STORAGE_KEY = 'dashLang';

function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) return saved;
  } catch (e) {}
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(nav) ? nav : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: commonEn, app: appEn },
    nl: { common: commonNl, app: appNl },
    fr: { common: commonFr, app: appFr },
    es: { common: commonEs, app: appEs },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'app'],
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

// The ~30 classic-global src/js/*.js dashboard scripts (see scriptLoader.js)
// load after this module and can't `import` it — expose a plain function
// and a DOM-attribute translator they (and the raw-HTML tab/modal fragments
// rendered via dangerouslySetInnerHTML) can use instead of react-i18next hooks.
window.t = (key, opts) => i18n.t(key, opts);
window.i18n = i18n;

export function applyDomI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    // Translate this node only while WE are the last thing that wrote to it.
    //
    // 30 of these ids are loading/empty placeholders that a tab script later
    // replaces with rendered content (#cronJobsList, #scoreDist, #riskAlerts,
    // #engineCredListEl, …). Without this guard every later pass — i.e. every
    // language switch — assigned the placeholder straight back over that
    // content, and since no tab script listens for `lang-changed`, nothing
    // ever re-rendered: the panel simply went blank-looking and stayed there.
    // That is workflow rule 39, and it was reported as "Scheduled Jobs will
    // not load in FR/ES" (fixed 2026-07-31).
    //
    // Comparing against what we last wrote keeps ordinary chrome (buttons,
    // labels, headings) re-translating normally, because its text still
    // matches; a node a script has claimed simply stops being ours. Deliberately
    // NOT applied to data-i18n-html below: that case — a translated block with
    // a script-written span nested inside it, e.g. markov's #mkThreshLabel —
    // is already solved by re-applying on `lang-changed`, which keeps the block
    // translated instead of freezing it at the language it was claimed in.
    const applied = el.dataset.i18nApplied;
    if (applied !== undefined && el.textContent !== applied) return;
    const next = i18n.t(el.getAttribute('data-i18n'));
    el.textContent = next;
    el.dataset.i18nApplied = next;
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = i18n.t(el.getAttribute('data-i18n-html'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = i18n.t(el.getAttribute('data-i18n-placeholder'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = i18n.t(el.getAttribute('data-i18n-title'));
  });
  // Custom tooltip system (src/js/ui-helpers.js reads el.dataset.tip live on
  // hover, not at parse time) — a separate attribute from data-tip itself so
  // the original English data-tip stays as a safe fallback if translation
  // ever fails to load, mirroring the data-i18n-title convention above.
  root.querySelectorAll('[data-i18n-tip]').forEach((el) => {
    el.dataset.tip = i18n.t(el.getAttribute('data-i18n-tip'));
  });
}
window.applyDomI18n = applyDomI18n;

// Mirrors theme-hooks.js's applyTheme()/toggleTheme() convention: localStorage
// is the source of truth, settings-sync.js's SETTINGS_SYNC_KEYS already picks
// up "dashLang" (see that file), and scheduleSettingsSync() — a classic-script
// global by the time a user can actually change language — pushes the change
// to the signed-in account immediately rather than waiting on the next
// debounce-triggering action elsewhere.
export function setDashLang(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) return;
  i18n.changeLanguage(lang);
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  applyDomI18n(document);
  // applyDomI18n replaces innerHTML wherever data-i18n-html is used, which
  // wipes any live value a tab script had written into a nested span (e.g.
  // markov's #mkThreshLabel). Tabs listen for this and re-apply their values.
  document.dispatchEvent(new CustomEvent('lang-changed', { detail: { lang } }));
  if (typeof scheduleSettingsSync === 'function') scheduleSettingsSync();
}
window.setDashLang = setDashLang;

export default i18n;
