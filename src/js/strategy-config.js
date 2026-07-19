    const PORTFOLIO_CAPS = {"BTC/USD": 30, "BTCUSD": 30, "ETH/USD": 15, "ETHUSD": 15, "ADA/USD": 10, "ADAUSD": 10, "SOL/USD": 10, "SOLUSD": 10, "DOGE/USD": 8, "DOGEUSD": 8, "LTC/USD": 6, "LTCUSD": 6, "DOT/USD": 6, "DOTUSD": 6, "LINK/USD": 5, "LINKUSD": 5, "AVAX/USD": 5, "AVAXUSD": 5, "AAVE/USD": 5, "AAVEUSD": 5};

    const DEFAULT_LIMITS = {
      maxDailyLossPct: 2.0,
      warningDailyLossPct: 1.0,
      maxOpenRiskPct: 5.0,
      warningOpenRiskPct: 3.0,
      maxSinglePositionPct: 30.0,
      warningSinglePositionPct: 20.0,
      assumedStopLossPct: 5.0,
      tradingDaysPerYear: 365,   // crypto trades 24/7 — annualize on calendar days, matches scripts/metrics.py (365)
      maxSignalSymbols: 30,
      maxOpenPositions: 7,   // aligned with config.json › risk (Bug #5 2026-07-10:
      maxPositionsPerTier: 5 // 15 was unreachable — 2 Tier-1 symbols + 5/tier caps the book at 7)
    };

    // 6-point signal-score gates — kept in sync with config.json > strategy
    // (loosened 2026-06-19). Used by every signal-score display + autopilot.
    // NOTE: separate from the gap-scanner "Conviction" score (max ±7).
    const SIGNAL_BUY_SCORE            = 3.5;  // full-size long gate
    const SIGNAL_HALF_SCORE           = 2.5;  // half-size long gate
    const SIGNAL_DOWNTREND_LONG_SCORE = 4.0;  // half-size counter-trend long allowed in a downtrend

    // Strategy/risk parameters shared with the Python engine. Defaults mirror
    // config.json › strategy/risk/data; loadConfigFromFile() overwrites them
    // from the file on page load (roadmap 2026-07-08) so a config change can't
    // silently fork the two engines. All *Pct values are in percent.
    const STRAT_CFG = {
      taExitScore:          -2,   // strategy.sell_score_threshold
      trailArmPct:          2.5,  // risk.trailing_stop_activation_pct × 100
      trailPct:             3,    // risk.trailing_stop_trail_pct × 100
      cashReservePct:       20,   // risk.min_cash_reserve_pct × 100
      swingLowLookback:     20,   // risk.swing_low_lookback_bars
      swingLowBufferPct:    0.1,  // risk.swing_low_buffer_pct × 100
      swingLowMaxStopPct:   8,    // risk.swing_low_max_stop_pct × 100
      minBarsForSignal:     60,   // data.min_bars_for_signal (aligned 2026-07-08; was 55)
      dailyDrawdownGatePct: 3,    // risk.daily_drawdown_gate_pct × 100
      escalationCycles:     2,    // risk.stop_loss_escalation_cycles
      escalationExtraPct:   0.3,  // risk.stop_loss_escalation_extra_pct × 100
      minStaleEntryAgeHours: 4,   // risk.min_stale_entry_age_hours — bug fix 2026-07-13
      // Roadmap 2026-07-09 additions:
      feeBpsPerSide:        25,   // costs.taker_fee_bps_per_side (Alpaca taker, per side)
      minRrFull:            1.5,  // strategy.min_rr_full  — net R:R soft gate (full size)
      minRrHalf:            1.0,  // strategy.min_rr_half  — below this, entry blocked
      rotationEnabled:      true, // strategy.rotation_enabled
      rotationMinScore:     4,    // strategy.rotation_min_score
      rotationMargin:       2,    // strategy.rotation_score_margin
      maxHoldHours:         48,   // risk.max_hold_hours — stale-position exit
      partialTpEnabled:     true, // risk.partial_tp_enabled — +1R scale-out ladder
      partialTpRMultiple:   1,    // risk.partial_tp_r_multiple
      partialTpFraction:    0.5,  // risk.partial_tp_fraction
      sessionFilterEnabled: true, // strategy.session_filter_enabled (ON since 2026-07-10 item 9 — self-guards on sessionMinSample per bucket)
      sessionMinSample:     20,   // strategy.session_min_sample — min round-trips per bucket
      // Roadmap 2026-07-10 addition:
      wfMaxAgeDays:         45    // walkforward.max_baseline_age_days — Backtest-tab staleness warning
    };

    // Round-trip trade cost as a % of notional (roadmap 2026-07-09 item 1):
    // taker fee on entry + exit plus the live bid-ask spread. Mirrors
    // risk.round_trip_cost_pct (Python). spreadPct may be null (no quote).
    function roundTripCostPct(spreadPct) {
      return 2 * STRAT_CFG.feeBpsPerSide / 100 + (spreadPct || 0);   // bps→% per side ×2
    }

    // Net-of-cost R:R for a long setup — mirrors risk.net_rr (Python).
    // Returns null when the stop/target geometry is invalid.
    function netRrPct(entry, stop, target, costPct) {
      if (!entry || !stop || stop >= entry || !target || target <= entry) return null;
      const reward = (target - entry) - entry * (costPct || 0) / 100;
      return reward / (entry - stop);
    }

    // Synthetic 4H bars from 1H bars (roadmap 2026-07-09 item 6 — mirrors
    // run_evaluation.aggregate_bars_to_4h). Buckets align to 4-hour UTC
    // boundaries; partial buckets (< 4 hourly bars) are dropped.
    function aggregate1hTo4h(bars1h) {
      const buckets = {}, order = [];
      for (const b of (bars1h || [])) {
        if (!b || !b.t || !b.c) continue;
        const dt = new Date(b.t);
        if (isNaN(dt)) continue;
        const key = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
                             Math.floor(dt.getUTCHours() / 4) * 4);
        if (!buckets[key]) { buckets[key] = []; order.push(key); }
        buckets[key].push(b);
      }
      const out = [];
      for (const key of order) {
        const grp = buckets[key];
        if (grp.length < 4) continue;
        out.push({
          t: new Date(key).toISOString(),
          o: grp[0].o,
          h: Math.max.apply(null, grp.map(g => g.h)),
          l: Math.min.apply(null, grp.map(g => g.l)),
          c: grp[grp.length - 1].c,
          v: grp.reduce((a, g) => a + (g.v || 0), 0)
        });
      }
      return out;
    }

    // 4H data fallback (item 6): for symbols whose native 4H fetch came back
    // short (< 51 bars — EMA50 needs 51), fetch 1H bars and substitute
    // synthetic 4H bars in place. Returns { synthetic: [syms], degraded: [syms] }
    // so callers can render the ⚠ marker / log the data-quality warning.
    async function fill4hFallback(symbols, bars4h) {
      const result = { synthetic: [], degraded: [] };
      if (!bars4h) return result;
      const short = symbols.filter(sym => {
        const n = ((bars4h[sym] || bars4h[sym.replace("/", "")]) || []).length;
        return n < 51;
      });
      if (!short.length) return result;
      let bars1h = null;
      try { bars1h = await fetchBars(short, "1Hour", 260); } catch (e) {}
      for (const sym of short) {
        const raw = bars1h ? (bars1h[sym] || bars1h[sym.replace("/", "")] || []) : [];
        const synth = aggregate1hTo4h(raw);
        if (synth.length >= 51) {
          bars4h[sym] = synth;
          delete bars4h[sym.replace("/", "")];   // one canonical key
          result.synthetic.push(sym);
        } else {
          result.degraded.push(sym);
        }
      }
      return result;
    }

    // 4H range-low (swing-low) stop — mirrors risk.swing_low_stop_price (Python).
    // Stop sits just below the lowest low of the last STRAT_CFG.swingLowLookback
    // 4H bars, clamped to at most STRAT_CFG.swingLowMaxStopPct below entry.
    // Returns null when 4H history is missing or the level is not a valid long
    // stop (caller then falls back to the fixed % stop).
    function swingLowStop4h(lows4h, entry) {
      if (!entry || !Array.isArray(lows4h)) return null;
      const lookback = STRAT_CFG.swingLowLookback;
      const win = lows4h.slice(-lookback).filter(l => l > 0);
      if (win.length < Math.min(lookback, 5)) return null;
      let stop = Math.min.apply(null, win) * (1 - STRAT_CFG.swingLowBufferPct / 100);
      if (stop >= entry) return null;
      const floor = entry * (1 - STRAT_CFG.swingLowMaxStopPct / 100);
      if (stop < floor) stop = floor;
      return stop;
    }

    const DEFAULT_BACKTEST = {
      expectedSharpe: 0.75,
      expectedMaxDrawdownPct: 8.0,
      expectedWinRatePct: 50.0,
      expectedProfitFactor: 1.20,
      expectedAvgDailyReturnPct: 0.05
    };

    const TILE_TIPS = {
      "Equity / NAV": "Current total account value. Used as the base for risk and exposure calculations.",
      "Today P&L": "Profit or loss since the previous equity snapshot. Used for daily loss-limit checks.",
      "Open Risk": "Estimated loss if open positions hit the assumed stop-loss percentage configured in Settings.",
      "Current Drawdown": "Current decline from the most recent equity high.",
      "Open Positions": "Number of currently active positions.",
      "Rule Adherence": "Percentage of journal entries where you followed or partially followed your plan.",
      "Total Return": "Portfolio return over the loaded account-history window.",
      "Average Return": "Average period return calculated from equity-history changes.",
      "Annualized Volatility": "Estimated annualized volatility based on portfolio-history returns.",
      "Best Period": "Best single return period in the loaded history.",
      "Worst Period": "Worst single return period in the loaded history.",
      "Filled Orders": "Number of recent orders with filled status.",
      "Max Drawdown": "Worst peak-to-trough decline in the loaded account history.",
      "Sharpe Ratio": "Risk-adjusted return. Higher means more return per unit of volatility.",
      "Sortino Ratio": "Downside-risk adjusted return.",
      "Calmar Ratio": "Annualized return divided by maximum drawdown.",
      "VaR 95%": "Historical 5th percentile return. A rough estimate of adverse one-period loss.",
      "CVaR 95%": "Average loss beyond the 95% VaR threshold.",
      "Invested": "Total market value of open positions.",
      "Cash": "Available cash in the account.",
      "Largest Position": "Largest single position as a percentage of equity.",
      "Buying Power": "Buying power reported by Alpaca.",
      "Open Orders": "Orders that are still open or unresolved.",
      "Canceled / Expired": "Recent orders that did not complete.",
      "Rejected Orders": "Orders rejected by the broker.",
      "Avg Slippage Proxy": "Approximation based on limit price versus average fill price.",
      "Favorable Fill Rate": "Share of orders where the slippage proxy was neutral or favorable.",
      "Journal Entries": "Number of local journal entries stored in this browser.",
      "Mistake Count": "Number of journal entries with a mistake tag.",
      "Impulsive Trades": "Number of journal entries marked as not following the plan.",
      "Top Mistake": "Most frequent mistake tag in your journal.",
      "Process Status": "Discipline status based on journal rule adherence.",
      "Strategy Health": "Live metrics compared against your expected/backtest metrics.",
      "Live Sharpe": "Sharpe ratio calculated from live account-history returns.",
      "Live Max DD": "Maximum drawdown calculated from live account-history equity.",
      "Avg Daily Return": "Average daily or period return from live account history.",
      "Profit Factor": "Gross realized wins ÷ gross realized losses, from FIFO-matched fills. n/a until there is at least one losing trade.",
      "Cash Reserve": "Available cash as % of equity. Hard rule: must stay ≥ 20% at all times.",
      "Connection": "Whether Alpaca API credentials are configured.",
      "Mode": "Paper or live account mode selected in Settings.",
      "Security": "Where credentials are stored."
    };
