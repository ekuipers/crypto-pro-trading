
    // ═══════════════════════════════════════════════════════════════════════
    //  DAILY JOURNAL — DOCUMENT GENERATOR (executable button)
    // ═══════════════════════════════════════════════════════════════════════
    let _journalMarkdown = "";
    let _journalFilename = "";

    function jGmt2Time() {
      return new Date().toLocaleTimeString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", minute: "2-digit" });
    }
    function jGmt2Date() {
      return new Date().toLocaleDateString("en-CA", { timeZone: "Etc/GMT-2" }); // YYYY-MM-DD
    }
    function jNum(n, dec = 2) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
    function jSign(n) { return (n >= 0 ? "+$" : "−$") + jNum(Math.abs(n)); }
    function jPct(n) { return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) + "%"; }

    async function generateDailyJournal() {
      const backdrop = $("journalDocBackdrop");
      $("journalDocSub").textContent = "Generating from live Alpaca data…";
      $("journalDocText").textContent = "⏳ Fetching account, positions and trade activities…";
      backdrop.style.display = "flex";
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) {
        $("journalDocSub").textContent = "Error";
        $("journalDocText").textContent = "⚠ Add your Alpaca API key and secret in Settings first.";
        return;
      }
      try {
        const today = jGmt2Date();
        const [acct, positions, activities] = await Promise.all([
          apiFetch("/v2/account"),
          apiFetch("/v2/positions"),
          // Full paginated FILL history — today's SELLs may FIFO-match a BUY older
          // than the last 100 fills; a single page would book those as $0 realized.
          edgeFetchAllFills().catch(() => []),
        ]);

        const equity   = parseFloat(acct.equity);
        const lastEq   = parseFloat(acct.last_equity);
        const cash     = parseFloat(acct.cash);
        const dayPL    = equity - lastEq;
        const dayPct   = lastEq ? dayPL / lastEq * 100 : 0;
        const cashPct  = equity ? cash / equity * 100 : 0;
        const unrealPL = positions.reduce((a, p) => a + parseFloat(p.unrealized_pl || 0), 0);

        const acts = Array.isArray(activities) ? activities : [];
        // Trades executed today (GMT+2 calendar day)
        const todays = acts.filter(a => {
          const d = new Date(a.transaction_time || a.date || 0).toLocaleDateString("en-CA", { timeZone: "Etc/GMT-2" });
          return d === today;
        });

        // FIFO realized P&L across all loaded fills (session), and today's realized slice
        const queues = {};
        let realizedToday = 0, winsToday = 0, lossesToday = 0;
        [...acts].reverse().forEach(a => {
          const sym = a.symbol, side = a.side;
          const qty = Math.abs(Number(a.qty || 0)), price = Number(a.price || 0);
          const d = new Date(a.transaction_time || a.date || 0).toLocaleDateString("en-CA", { timeZone: "Etc/GMT-2" });
          if (!queues[sym]) queues[sym] = [];
          if (side === "buy") { queues[sym].push({ qty, price }); }
          else if (side === "sell") {
            let rem = qty, pnl = 0;
            while (rem > 0 && queues[sym] && queues[sym].length) {
              const e = queues[sym][0];
              const m = Math.min(rem, e.qty);
              pnl += m * (price - e.price);
              e.qty -= m; rem -= m;
              if (e.qty < 1e-6) queues[sym].shift();
            }
            if (d === today) { realizedToday += pnl; if (pnl >= 0) winsToday++; else lossesToday++; }
          }
        });

        const time = jGmt2Time();
        let md = `## Daily Journal ${time} GMT+2\n\n`;

        // ── Summary ──
        md += `### Summary\n`;
        md += `- **Equity (close)**: $${jNum(equity)}\n`;
        md += `- **Day P&L**: ${jSign(dayPL)} (${jPct(dayPct)}) vs. day-open equity $${jNum(lastEq)}\n`;
        md += `- **Cash**: $${jNum(cash)} (${cashPct.toFixed(1)}% of equity)\n`;
        md += `- **Open positions**: ${positions.length} · unrealized P&L ${jSign(unrealPL)}\n`;
        md += `- **Trades executed today**: ${todays.length} · realized P&L ${jSign(realizedToday)} (${winsToday}W / ${lossesToday}L)\n\n`;

        // ── Trades Today ──
        md += `### Trades Today\n`;
        if (todays.length) {
          md += `| Time (GMT+2) | Symbol | Side | Qty | Fill Price |\n`;
          md += `|--------------|--------|------|-----|------------|\n`;
          // chronological order
          [...todays].reverse().forEach(a => {
            const t = new Date(a.transaction_time || a.date || 0).toLocaleTimeString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", minute: "2-digit" });
            md += `| ${t} | ${toSlash(a.symbol)} | ${String(a.side || "").toUpperCase()} | ${jNum(Math.abs(Number(a.qty || 0)), 4)} | $${fmtPrice(Number(a.price || 0))} |\n`;
          });
          md += `\n`;
        } else {
          md += `No trades — quiet day. Reason: no signal cleared the entry/exit gate during today's evaluation cycles.\n\n`;
        }

        // ── Open Positions ──
        md += `### Open Positions (close of day)\n`;
        if (positions.length) {
          md += `| Symbol | Side | Qty | Entry | Current | Mkt Val | % Equity | Unrl P&L |\n`;
          md += `|--------|------|-----|-------|---------|---------|----------|----------|\n`;
          positions.forEach(p => {
            const qty = parseFloat(p.qty), isShort = qty < 0;
            const mv = Math.abs(parseFloat(p.market_value));
            const portPct = equity ? mv / equity * 100 : 0;
            md += `| ${toSlash(p.symbol)} | ${isShort ? "short" : "long"} | ${jNum(Math.abs(qty), 4)} | $${fmtPrice(parseFloat(p.avg_entry_price))} | $${fmtPrice(parseFloat(p.current_price))} | $${jNum(mv)} | ${portPct.toFixed(1)}% | ${jSign(parseFloat(p.unrealized_pl || 0))} (${jPct(parseFloat(p.unrealized_plpc || 0) * 100)}) |\n`;
          });
          md += `\n`;
        } else {
          md += `Flat — no open positions at close.\n\n`;
        }

        // ── Market Observations (watchlist confluence snapshot) ──
        $("journalDocText").textContent = "⏳ Scanning watchlist confluence for observations…";
        md += `### Market Observations\n`;
        let scan = [];
        try {
          const _jwl = getWatchlist();
          const [b15, b4h, bD] = await Promise.all([
            fetchBars(_jwl, "15Min", 120),
            fetchBars(_jwl, "4Hour", 60),
            fetchBars(_jwl, "1Day", 60),
          ]);
          scan = _jwl.map(sym => {
            const a = (b15 || {})[sym], c = (b4h || {})[sym], d = (bD || {})[sym];
            if (!a || a.length < 50) return null;
            const r = calcSignalScore(a, c || [], d || []);
            return { sym, score: r.score, regime: r.dailyRegime };
          }).filter(Boolean);
        } catch (e) { scan = []; }

        if (scan.length) {
          const top = scan.slice().sort((a, b) => b.score - a.score)[0];
          const bot = scan.slice().sort((a, b) => a.score - b.score)[0];
          const up = scan.filter(r => r.regime === "uptrend").length;
          const dn = scan.filter(r => r.regime === "downtrend").length;
          const mx = scan.filter(r => r.regime === "mixed").length;
          let obs = `Closing watchlist scan: strongest setup is ${top.sym} at ${(top.score >= 0 ? "+" : "−") + Math.abs(top.score).toFixed(1)}, weakest is ${bot.sym} at ${(bot.score >= 0 ? "+" : "−") + Math.abs(bot.score).toFixed(1)}. `;
          obs += `Daily regimes: ${up} uptrend, ${dn} downtrend, ${mx} mixed. `;
          obs += dayPL >= 0 ? `Portfolio finished the day up ${jPct(dayPct)}. ` : `Portfolio finished the day down ${jPct(dayPct)}. `;
          obs += cashPct >= 20 ? `Cash reserve at ${cashPct.toFixed(1)}% — above the 20% minimum.` : `Cash reserve at ${cashPct.toFixed(1)}% — below the 20% minimum; rebalance to restore the buffer.`;
          md += obs + `\n\n`;
          md += `| Symbol | Score | Daily Regime |\n|--------|-------|--------------|\n`;
          scan.forEach(r => { md += `| ${r.sym} | ${(r.score >= 0 ? "+" : "−") + Math.abs(r.score).toFixed(1)} | ${r.regime} |\n`; });
          md += `\n`;
        } else {
          md += `Watchlist scan unavailable (insufficient bar data). Day P&L ${jPct(dayPct)}; cash reserve ${cashPct.toFixed(1)}%.\n\n`;
        }

        md += `---\n`;

        _journalMarkdown = md;
        _journalFilename = `daily-journal-${today}.md`;
        $("journalDocSub").textContent = `Generated ${time} GMT+2 · ${_journalFilename}`;
        $("journalDocText").textContent = md;
      } catch (e) {
        $("journalDocSub").textContent = "Error";
        $("journalDocText").textContent = "⚠ Failed to generate journal: " + e.message;
        console.error(e);
      }
    }

    function closeJournalDoc() { $("journalDocBackdrop").style.display = "none"; }
    function downloadJournalDoc() {
      if (!_journalMarkdown) return;
      const blob = new Blob([_journalMarkdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = _journalFilename; a.click();
      URL.revokeObjectURL(url);
    }
    function copyJournalDoc() {
      if (_journalMarkdown && navigator.clipboard) navigator.clipboard.writeText(_journalMarkdown);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════════════════════════════

    (function initKeyboardShortcuts() {
      const TAB_ORDER = ["command","signals","scalp","market","execution","port-overview","port-dist","risk","analytics","insights","backtest","markov","settings"];
      document.addEventListener("keydown", function(e) {
        // Ignore when typing in an input/textarea
        if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9) {
          const id = TAB_ORDER[n - 1];
          if (id) {
            const btn = Array.from(document.querySelectorAll(".tab-btn")).find(b => b.getAttribute("onclick") && b.getAttribute("onclick").includes(`'${id}'`));
            switchTab(id, btn);
          }
        }
        if (e.key === "r" || e.key === "R") refreshCurrent();
      });
    })();
