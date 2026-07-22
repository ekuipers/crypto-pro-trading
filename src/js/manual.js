// ══════════════ USER MANUAL (roadmap: red ❓ Help button, unfolds from the left) ══════════════
// Static, hand-written reference content — no markdown fetch, no external file.
// Mirrors the pattern CryptoPro Charts uses for its own in-app manual (helpBtn +
// off-canvas #manualPanel + TOC/content/search), ported as a classic global script
// since this project's src/js/*.js files share one scope instead of ES modules.

const MANUAL_SECTIONS = [
  {
    id: "overview",
    title: "Overview",
    html: `
      <p>CryptoPro Trader is a paper-crypto trading cockpit built around Alpaca's crypto API. The left sidebar groups every tab by job-to-be-done: <b>🧭 Command</b> to act, <b>⚡ Trade</b> / <b>💼 Portfolio</b> to hold, <b>📊 Analysis</b> to review.</p>
      <p>Each tab keeps its own state in the URL hash, so you can bookmark or share a direct link to any tab — a browser refresh reopens the last tab you had open instead of resetting to Command.</p>
      <p>Before trading, open <b>⚙ Settings</b> and enter your Alpaca paper (or live) API key and secret. Nothing is sent anywhere except Alpaca's own API — credentials stay in your browser's local storage unless you're signed in (see <b>Account &amp; sign-in</b> below).</p>
    `,
  },
  {
    id: "command",
    title: "🧭 Command",
    html: `
      <p>The trading-permission cockpit. The <b>Overview</b> sub-tab shows whether you're currently allowed to trade: live hard-rules checks, cash-reserve gate, equity/cash/open-risk/drawdown KPIs, and the last two fill activities.</p>
      <p>The <b>🤖 Autopilot</b> panel runs an automatic entry/exit loop in your browser tab — it stays off by default on every page load, tags its own orders <code>ap-</code>, and has a red ⛔ kill switch that cancels every open order and stops the loop immediately. Autopilot only works while this browser tab stays open.</p>
      <p>The <b>☁ Scheduled Jobs</b> sub-tab (only visible to the account owner) shows the last run of the server-side cron jobs — evaluate / watchdog / daily summary — with a per-job enable toggle, an hour-of-day schedule picker, and a manual "Run now" button.</p>
      <p>The <b>📰 News</b>, <b>🐦 Socials</b>, and <b>📖 Glossary</b> sub-tabs are analysis-only — they never place orders. Glossary renders this project's trading-term dictionary straight into the dashboard with a live search box.</p>
    `,
  },
  {
    id: "trade",
    title: "⚡ Trade",
    html: `
      <p><b>Signals</b> runs the 6-point Signal Confluence scanner across your watchlist: EMA cross, MACD histogram, RSI, Bollinger %b, volume ratio, and 4H regime, each summed into one score. Use the ⚡ button for a quick pre-filled buy, or ▶ to open the full trade ticket.</p>
      <p><b>⚡ Scalping</b> is a faster, lower-timeframe (5m/15m/1h) confluence scanner for shorter holding periods, with the same manual Buy/Sell controls.</p>
      <p><b>Market</b> nests three sub-tabs: <i>Market Overview</i> (price/volume/trend across the whole tradable universe), <i>🔭 Scanner</i> (an on-demand full confluence scan you can add straight to your watchlist from), and <i>📊 Breakout</i> (pre-session gap/breakout analysis per watchlist symbol).</p>
      <p><b>Execution</b> lists open and recent orders with Symbol/Type/Side/Status filters, one-click cancel-all, limit-band compliance, and the ATR position-sizer widget (risk-based quantity from your equity, ATR, and entry price).</p>
      <p>Every order this dashboard submits — manual or Autopilot — is a <b>limit order</b>, within a tight band of the current ask. Nothing here places market orders.</p>
    `,
  },
  {
    id: "portfolio",
    title: "💼 Portfolio",
    html: `
      <p><b>Overview</b> shows account equity, cash, buying power, and P&amp;L cards, the equity curve, and your open positions table.</p>
      <p><b>Allocation</b> is a donut chart of how your equity is split across positions and cash, plus a cap-utilisation table for every watchlist symbol — Over Cap / Near Cap / OK badges tell you at a glance which symbols are close to their per-symbol portfolio cap.</p>
    `,
  },
  {
    id: "analysis",
    title: "📊 Analysis",
    html: `
      <p><b>🔬 Analytics</b> nests three sub-tabs: <i>📈 Performance</i> (equity curve, return/volatility KPIs, rolling metrics), <i>💰 P&amp;L</i> (FIFO realized profit/loss, calendar heatmap, per-symbol attribution), and <i>🔬 Edge</i> (expectancy by symbol and by hour-of-day/day-of-week).</p>
      <p><b>⚠️ Risk</b> shows per-symbol cap usage, a 10×10 correlation heatmap, and drawdown/Sharpe/Sortino/Calmar/VaR figures.</p>
      <p><b>🧠 Insights</b> reads your realized trade history for behavioral patterns — day-of-week edge, performance after losing streaks, cadence after a win, and rule-discipline breaches.</p>
      <p><b>🧪 Backtest vs Live</b> compares your live results to saved expected backtest metrics. <b>🔗 Markov</b> runs a first-order Markov chain analysis on BTC/USD and ETH/USD across several lookback windows.</p>
      <p>Every tab in this section is analysis-only — none of them place orders.</p>
    `,
  },
  {
    id: "settings",
    title: "⚙ Settings",
    html: `
      <p>Enter your Alpaca paper and/or live API credentials here first — most of the dashboard has nothing to show without them.</p>
      <p>Risk Limits controls position caps and Signals Analysis controls how many symbols get scanned. <b>🔗 Correlation Budget</b> sets how many open Autopilot positions are allowed in total and per tier (Tier-1 = BTC/ETH).</p>
      <p><b>📋 Active Watchlist</b> is the up-to-20-symbol list every scanner, the Daily Journal, and Autopilot use — add or remove symbols from the dropdown, or reset to the default set.</p>
      <p>If you're signed in (see below), most of these settings sync automatically across your devices. Alpaca API keys and Autopilot's live runtime state never sync — they stay local to this browser only.</p>
    `,
  },
  {
    id: "account",
    title: "Account &amp; sign-in",
    html: `
      <p>The <b>👤 Sign in</b> button in the header is a single sign-on account shared across the whole CryptoPro suite (Trader, Charts, Training) — one account, one password, optional TOTP two-factor authentication.</p>
      <p>Signing in lets your theme, last-open tab, watchlist, and non-secret settings follow you between devices and browsers. It does not sync your Alpaca API keys or Autopilot's live position bookkeeping — those are deliberately kept local to the browser you're trading from.</p>
    `,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    html: `
      <p><code>1</code>–<code>9</code> jump straight to the first nine sidebar tabs, in the order they're listed (Command…Settings). <code>R</code> refreshes whichever tab is currently open.</p>
    `,
  },
];

function manualTocHtml(filter) {
  const q = (filter || "").trim().toLowerCase();
  return MANUAL_SECTIONS
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.html.toLowerCase().includes(q))
    .map((s) => `<button type="button" class="manual-toc-btn" data-id="${s.id}">${s.title}</button>`)
    .join("");
}

function manualContentHtml(id) {
  const section = MANUAL_SECTIONS.find((s) => s.id === id) || MANUAL_SECTIONS[0];
  return `<h3>${section.title}</h3>${section.html}`;
}

function manualSelectSection(id) {
  const content = $("manualContent");
  if (content) content.innerHTML = manualContentHtml(id);
  const buttons = document.querySelectorAll("#manualToc .manual-toc-btn");
  buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.id === id));
}

function manualRenderToc(filter) {
  const toc = $("manualToc");
  if (toc) toc.innerHTML = manualTocHtml(filter);
}

function toggleManualPanel(open) {
  const panel = $("manualPanel");
  if (!panel) return;
  const shouldOpen = open === undefined ? !panel.classList.contains("open") : open;
  panel.classList.toggle("open", shouldOpen);
}

function initManualGuide() {
  const helpBtn = $("helpBtn");
  const panel = $("manualPanel");
  const closeBtn = $("closeManualBtn");
  const search = $("manualSearch");
  if (!helpBtn || !panel) return;

  manualRenderToc("");
  manualSelectSection(MANUAL_SECTIONS[0].id);

  helpBtn.addEventListener("click", () => toggleManualPanel());
  if (closeBtn) closeBtn.addEventListener("click", () => toggleManualPanel(false));

  if (search) {
    search.addEventListener("input", () => manualRenderToc(search.value));
  }

  $("manualToc").addEventListener("click", (e) => {
    const btn = e.target.closest(".manual-toc-btn");
    if (btn) manualSelectSection(btn.dataset.id);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) toggleManualPanel(false);
  });
}

initManualGuide();
