
    function returnsFromEquity(eq) {
      const out = [];
      for (let i = 1; i < eq.length; i++) {
        if (eq[i - 1]) out.push((eq[i] - eq[i - 1]) / eq[i - 1]);
      }
      return out;
    }

    function mean(arr) {
      if (!arr.length) return 0;
      return arr.reduce((s, x) => s + x, 0) / arr.length;
    }

    function std(arr) {
      if (arr.length < 2) return 0;
      const m = mean(arr);
      const v = arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / (arr.length - 1);
      return Math.sqrt(v);
    }

    function downsideStd(arr) {
      return std(arr.filter(x => x < 0));
    }

    function percentile(arr, p) {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a,b) => a-b);
      const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)));
      return s[idx];
    }

    function cvar(arr, p) {
      if (!arr.length) return 0;
      const threshold = percentile(arr, p);
      const tail = arr.filter(x => x <= threshold);
      return mean(tail);
    }

    function drawdown(eq) {
      let peak = -Infinity;
      let maxDD = 0;
      let currentDD = 0;
      const series = [];

      eq.forEach(v => {
        if (v > peak) peak = v;
        const dd = peak ? (v - peak) / peak : 0;
        series.push(dd * 100);
        if (dd < maxDD) maxDD = dd;
        currentDD = dd;
      });

      return {
        currentDDPct: currentDD * 100,
        maxDDPct: maxDD * 100,
        series
      };
    }

    function sharpe(returns, tradingDays) {
      const s = std(returns);
      if (!s) return 0;
      return mean(returns) / s * Math.sqrt(tradingDays);
    }

    function sortino(returns, tradingDays) {
      const s = downsideStd(returns);
      if (!s) return 0;
      return mean(returns) / s * Math.sqrt(tradingDays);
    }

    function annualReturn(returns, tradingDays) {
      if (!returns.length) return 0;
      const compounded = returns.reduce((acc, r) => acc * (1 + r), 1);
      return Math.pow(compounded, tradingDays / returns.length) - 1;
    }

    function calmar(returns, maxDDPct, tradingDays) {
      if (!maxDDPct) return 0;
      return annualReturn(returns, tradingDays) / Math.abs(maxDDPct / 100);
    }

    // FIFO realized-P&L matching. Single source of truth shared by the P&L tab
    // (loadPnl) and the Backtest tab (renderBacktest) so their realized win-rate
    // and profit-factor numbers can never diverge. Long-only matching (buy → sell),
    // identical to the engine the P&L tab originally shipped with.
    function computeFifoStats(activities) {
      const list = Array.isArray(activities) ? activities : [];
      const queues = {}; // symbol -> [{qty, price}]
      const trades = [];
      let totalPnl = 0, wins = 0, losses = 0, winPnl = 0, lossPnl = 0;

      // Alpaca returns activities most-recent-first; reverse for chronological FIFO.
      const sorted = [...list].reverse();

      for (const act of sorted) {
        const sym = act.symbol;
        const side = act.side;
        const qty = Math.abs(Number(act.qty || 0));
        const price = Number(act.price || 0);
        const date = (act.transaction_time || act.date || "").slice(0, 10);

        if (!queues[sym]) queues[sym] = [];

        if (side === "buy") {
          queues[sym].push({ qty, price });
          trades.push({ date, sym, side: "BUY", qty, price, pnl: null, status: act.order_status || "filled" });
        } else if (side === "sell") {
          let remaining = qty;
          let realizedPnl = 0;
          let matchedQty = 0;
          while (remaining > 0 && queues[sym] && queues[sym].length > 0) {
            const entry = queues[sym][0];
            const matched = Math.min(remaining, entry.qty);
            realizedPnl += matched * (price - entry.price);
            matchedQty += matched;
            entry.qty -= matched;
            remaining -= matched;
            if (entry.qty < 0.000001) queues[sym].shift();
          }
          if (matchedQty > 1e-9) {
            // Only a SELL that matched a prior BUY is a realized round-trip. An
            // unmatched SELL (empty FIFO queue) would otherwise book a phantom
            // $0 "win" (realizedPnl stays 0) and inflate the win rate — the same
            // class of bug the 2026-07-06 full-history fix addressed in the data
            // source. Edge/Insights already skip these; align the shared engine.
            totalPnl += realizedPnl;
            if (realizedPnl >= 0) { wins++; winPnl += realizedPnl; }
            else { losses++; lossPnl += Math.abs(realizedPnl); }
            trades.push({ date, sym, side: "SELL", qty, price, pnl: realizedPnl, status: act.order_status || "filled" });
          } else {
            // Keep it in the trade log (pnl null → shows "–", not counted).
            trades.push({ date, sym, side: "SELL", qty, price, pnl: null, status: act.order_status || "filled" });
          }
        }
      }

      const totalTrades = wins + losses;
      return {
        totalPnl, wins, losses, winPnl, lossPnl,
        winRate: totalTrades ? wins / totalTrades * 100 : null,
        profitFactor: lossPnl > 0 ? winPnl / lossPnl : null,
        avgWin: wins > 0 ? winPnl / wins : null,
        avgLoss: losses > 0 ? lossPnl / losses : null,
        tradeRows: [...trades].reverse() // most-recent-first (matches loadPnl ordering)
      };
    }
