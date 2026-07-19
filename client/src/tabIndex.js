// Raw HTML for each top-level tab, copied verbatim from the prior EJS
// partials (views/tabs/*.ejs) — unchanged markup, still expects the exact
// DOM ids/classes that src/js/nav.js's switchTab()/_activateSubTab() and
// every tab's load*()/render*() function already look up.
import command from './tabs/command.html?raw';
import analytics from './tabs/analytics.html?raw';
import risk from './tabs/risk.html?raw';
import execution from './tabs/execution.html?raw';
import signals from './tabs/signals.html?raw';
import backtest from './tabs/backtest.html?raw';
import market from './tabs/market.html?raw';
import markov from './tabs/markov.html?raw';
import insights from './tabs/insights.html?raw';
import scalp from './tabs/scalp.html?raw';
import portOverview from './tabs/port-overview.html?raw';
import portDist from './tabs/port-dist.html?raw';
import settings from './tabs/settings.html?raw';

// Order matches the original dashboard's tab markup order (cosmetic only —
// display order is controlled by nav clicks / .page.active, not this list).
export const TABS = [
  command,
  analytics,
  risk,
  execution,
  signals,
  backtest,
  market,
  markov,
  insights,
  scalp,
  portOverview,
  portDist,
  settings,
];
