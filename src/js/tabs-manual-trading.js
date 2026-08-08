
// ═══════════════════════════════════════════════════════════
//  🧪 MANUAL TRADING — Command sub-tab (Suite roadmap item 1)
// ═══════════════════════════════════════════════════════════
//
// A paper-trading sandbox: the user opens/closes positions themselves,
// browser-side, separate from the automated cron engine and Autopilot.
// Reuses existing building blocks end to end rather than reimplementing:
//   - order placement:     trade-modal.js's openTradeModal()/submitPaperTrade()
//   - the score:            ta-lib.js's calcSignalScore() -- parity-tested
//                            against the engine (src/scoreParity.test.js).
//                            Never fork this logic.
//   - bars:                 market-data.js's fetchBars(), batched per
//                            timeframe across the whole symbol set, not
//                            per-row.
//   - presentation:         tabs-portfolio.js's portScoreBar()/portActionChip()
//                            -- defined there but, until this file, called
//                            from nowhere. This is their first real caller;
//                            portConfluenceScore() (a separate, unused,
//                            parity-risk reimplementation of the score in
//                            the same file) is deliberately NOT used.
//   - positions/watchlist:  api-config.js's apiFetch(), analytics-watchlist.js's
//                            getWatchlist() -- the same per-tenant list the
//                            cron engine now scans (2026-08-08 Free/Pro work).

// Free plan: how many concurrent open positions this tab will let the user
// open via Buy. Mirrors src/risk.js's FREE_MAX_OPEN_POSITIONS -- same mirror
// convention as analytics-watchlist.js's FREE_WATCHLIST_LIMIT. Client-side
// courtesy gate only: the real backstop for the *automated* engine is
// evaluateSymbol.js's Gate 2b; a manual order placed here still goes
// straight to Alpaca with no server-side position-count check (same trust
// level the Portfolio-tab trade modal has always had for its Buy button).
const MT_FREE_MAX_OPEN_POSITIONS = 2;

let mtPositions = [];
let mtLoading = false;

async function loadManualTrading() {
  if (mtLoading) return;
  mtLoading = true;
  const body = $("mtBody");
  try {
    const s = getSettings();
    if (!s.apiKey || !s.apiSecret) {
      body.innerHTML = '<tr><td colspan="7" class="placeholder">' + tt("rtc", "needCreds", "Configure API credentials in Settings first.") + '</td></tr>';
      return;
    }
    body.innerHTML = '<tr><td colspan="7" class="placeholder">' + tt("command", "mtScanning", "Scanning…") + '</td></tr>';

    const positions = await apiFetch("/v2/positions");
    mtPositions = positions;

    const wl = getWatchlist();
    const heldSymbols = positions.map(p => toSlash(p.symbol));
    const symbols = [...new Set([...wl, ...heldSymbols])];

    if (!symbols.length) {
      body.innerHTML = '<tr><td colspan="7" class="placeholder">' + tt("command", "mtEmpty", "Your watchlist is empty — add symbols in Settings.") + '</td></tr>';
      return;
    }

    const [bars15, bars4h, barsD] = await Promise.all([
      fetchBars(symbols, "15Min", 120),
      fetchBars(symbols, "4Hour", 60),
      fetchBars(symbols, "1Day", 60),
    ]);

    const rows = symbols.map(sym => {
      const alpacaSym = sym.replace("/", "");
      const b15 = (bars15[sym] || bars15[alpacaSym] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
      const b4h = (bars4h[sym] || bars4h[alpacaSym] || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
      const bD  = (barsD[sym]  || barsD[alpacaSym]  || []).map(b => ({ c: b.c, h: b.h, l: b.l, v: b.v }));
      const pos = positions.find(p => toSlash(p.symbol) === sym) || null;

      if (b15.length < STRAT_CFG.minBarsForSignal) {
        return { sym, score: null, dailyRegime: "n/a", lastClose: null, pos };
      }
      const res = calcSignalScore(b15, b4h, bD);
      return { sym, score: res.score, dailyRegime: res.dailyRegime, lastClose: res.lastClose, pos };
    });

    mtRender(rows);
  } catch (e) {
    body.innerHTML = '<tr><td colspan="7" class="placeholder"></td></tr>';
    body.firstElementChild.firstElementChild.textContent = "⚠ " + e.message;
    console.error(e);
  } finally {
    mtLoading = false;
  }
}

function mtRender(rows) {
  const body = $("mtBody");
  const plan = typeof window.getCurrentPlan === "function" ? window.getCurrentPlan() : "free";
  const heldCount = mtPositions.length;
  const atCap = plan !== "pro" && heldCount >= MT_FREE_MAX_OPEN_POSITIONS;

  body.innerHTML = rows.map(r => {
    const pos = r.pos;
    const qty = pos ? parseFloat(pos.qty) : 0;
    const isShort = pos && qty < 0;
    const current = pos ? parseFloat(pos.current_price) : r.lastClose;
    const orderSym = pos ? pos.symbol : r.sym.replace("/", "");
    const posCell = pos
      ? fmt(Math.abs(qty), Math.abs(qty) % 1 === 0 ? 0 : 6) + " @ " + fmtPrice(pos.avg_entry_price) + (isShort ? " (" + tt("command", "mtShort", "short") + ")" : "")
      : '<span style="color:var(--muted)">' + tt("command", "mtFlat", "flat") + '</span>';
    const unrPct = pos ? parseFloat(pos.unrealized_plpc) : null;
    const plCell = unrPct != null ? `<span class="${plClass(unrPct)}">${portPctFmt(unrPct, true)}</span>` : "–";

    let actionBtn;
    if (isShort) {
      actionBtn = `<button class="trade-close-btn" onclick="openTradeModal('${orderSym}','${r.sym}','buy','${Math.abs(qty)}',${current})">${tt("perf", "rtCoverBtn", "Buy / Cover")}</button>`;
    } else if (pos) {
      actionBtn = `<button class="trade-close-btn" onclick="openTradeModal('${orderSym}','${r.sym}','sell','${qty}',${current})">${tt("perf", "rtSellBtn", "Sell / Close")}</button>`;
    } else if (atCap) {
      actionBtn = `<button class="btn" onclick="mtBlockedByPlanCap()">${tt("command", "mtUpgradeBtn", "Upgrade to open")}</button>`;
    } else {
      actionBtn = `<button class="trade-action-btn" onclick="openTradeModal('${orderSym}','${r.sym}','buy','',${current || ""})">${tt("perf", "rtBuyBtn", "Buy")}</button>`;
    }

    return `<tr>
      <td><span class="symbol">${r.sym}</span></td>
      <td>${r.score != null ? portScoreBar(r.score) : "–"}</td>
      <td>${portActionChip(r.score || 0, r.dailyRegime)}</td>
      <td class="right mono">${current ? fmtPrice(current) : "–"}</td>
      <td>${posCell}</td>
      <td class="right">${plCell}</td>
      <td><div class="trade-actions">${actionBtn}</div></td>
    </tr>`;
  }).join("");
}

// The trade-modal path (openTradeModal -> submitPaperTrade) has no notion of
// this tab's Free-tier cap, so a Buy on a flat row that's already at the cap
// is intercepted here instead of opening the modal at all.
function mtBlockedByPlanCap() {
  alert(tt("command", "mtCapAlert", "Free plan is capped at {{n}} open positions — upgrade to Pro to open more.", { n: MT_FREE_MAX_OPEN_POSITIONS }));
  if (typeof window.openPlansModal === "function") window.openPlansModal();
}
