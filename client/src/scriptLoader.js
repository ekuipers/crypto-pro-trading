// Loads the 31 dashboard scripts (src/js/*.js, served by the Express server
// at /js/*) as classic, non-module scripts sharing one global scope — the
// same file set and load order as the prior EJS shell's <script> tags. They
// must load *after* React's first render puts the .page divs in the
// document, since the last file's bootstrapDashboard() touches the DOM
// immediately — see App.jsx's useEffect.
export const SCRIPT_ORDER = [
  'strategy-config.js',
  'utils.js',
  'api-config.js',
  'nav.js',
  'tabs-news.js',
  'tabs-socials.js',
  'tabs-glossary.js',
  'nav-routing.js',
  'stats.js',
  'tabs-command.js',
  'tabs-performance-risk-execution.js',
  'tabs-backtest-settings.js',
  'charts.js',
  'trade-modal.js',
  'ui-helpers.js',
  'ta-lib.js',
  'market-data.js',
  'tabs-markov.js',
  'tabs-signals.js',
  'tabs-pnl.js',
  'analytics-watchlist.js',
  'daily-journal-shortcuts.js',
  'theme-hooks.js',
  'tabs-gapgo.js',
  'tabs-scalping.js',
  'tabs-market.js',
  'autopilot.js',
  'edge-insights.js',
  'tabs-portfolio.js',
  'auth.js',
  'settings-sync.js',
  'manual.js',
  'terms-modal.js',
  'main.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Failed to load ' + src));
    document.body.appendChild(el);
  });
}

let started = false;

// Loads every dashboard script in order, each awaited before the next (so
// execution order exactly matches classic sequential <script> tags). Safe to
// call more than once (e.g. React StrictMode double-invoking effects in dev)
// — only the first call actually runs.
export async function loadDashboardScripts() {
  if (started) return;
  started = true;
  for (const file of SCRIPT_ORDER) {
    await loadScript('/js/' + file);
  }
}
