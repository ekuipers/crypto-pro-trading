
    // ── 📖 Command › Glossary (roadmap 2026-07-18) ────────────────────────────
    // Renders memory/glossary.md straight into the dashboard so trading terms,
    // acronyms, and dated feature notes are one click away from the tabs that
    // use them, instead of living only in the repo. A tiny markdown subset is
    // supported (headers, tables, `**bold**`, `` `code` ``, `---` rules) since
    // that's all glossary.md uses. Read-only reference — never places orders.
    let _glossaryMd = "";
    let _glossaryFetchedAt = 0;
    let _glossaryLive = false;   // true once a real fetch of memory/glossary.md succeeds
    const GLOSSARY_CACHE_MS = 5 * 60 * 1000;

    // Built-in fallback used when the live fetch fails — most browsers (Chrome
    // especially) block fetch()/XHR of a local sibling file when the dashboard
    // is opened directly via file://, with no workaround available from page
    // script (bug filed 2026-07-18: the tab showed a dead-end error instead of
    // ever rendering anything). This is a small, low-churn curated subset —
    // acronyms and the core conceptual trading terms, not the fast-changing
    // dated/implementation-detail sections — so the tab always shows something
    // useful even offline. The full, always-current file still renders live
    // whenever the fetch succeeds (served over local HTTP, or a browser that
    // allows it).
    const GLOSSARY_FALLBACK_MD = [
      "## Acronyms & Abbreviations",
      "",
      "| Term | Meaning | Context |",
      "|------|---------|---------|",
      "| ATR | Average True Range | Volatility measure; used for stop distance & position sizing |",
      "| BB | Bollinger Bands | 20-period, 2σ envelope around SMA |",
      "| EMA | Exponential Moving Average | Weighted MA; reacts faster than SMA |",
      "| HH / HL | Higher High / Higher Low | Bullish structure |",
      "| LH / LL | Lower High / Lower Low | Bearish structure |",
      "| MACD | Moving Average Convergence Divergence | 12/26 EMA diff; 9-period signal line |",
      "| R:R | Risk-to-Reward ratio | Stop distance vs take-profit distance (need ≥1:2, prefer 1:3) |",
      "| RSI | Relative Strength Index | Wilder method, 14-period; overbought >70, oversold <30 |",
      "| SMA | Simple Moving Average | Equal-weight average |",
      "| SoS | Sign of Strength | Wyckoff: volume-confirmed breakout above trading range |",
      "| %b | Bollinger percent-B | Position within band: 0=lower, 1=upper |",
      "",
      "---",
      "",
      "## Trading Terms (core)",
      "",
      "| Term | Meaning |",
      "|------|---------|",
      "| Confluence score | 6-point TA signal score; ≥3.5 = buy, ≥2.5 = half-size, <2.5 = hold; ≤−4 = short, −3 = half-size short, ≥+2 = cover |",
      "| Wyckoff phases | Accumulation (buy zone) → Mark-Up (uptrend) → Distribution (exit zone) → Mark-Down (downtrend) |",
      "| Golden cross / Death cross | 20 EMA crosses above / below 50 EMA → bullish / bearish |",
      "| BB squeeze | Bollinger bandwidth in bottom 20% of last 60 bars → breakout pending |",
      "| Regime (daily) | last_close > 50-day SMA AND 20-day SMA > 50-day SMA = uptrend |",
      "| Hard cap | Per-symbol position cap from `config.json › portfolio_caps.caps`, enforced in `trade.py` |",
      "| ATR sizing | 1% risk rule: qty = (equity×1%) / (ATR×1.5), capped at the symbol's cap |",
      "| Trailing stop | Activates once a long position is ≥2.5% in profit; trails 3% below the high-water mark (HWM) |",
      "| HWM | High-water mark — the highest close price seen since entry. Ratchets up only, never down |",
      "| Correlation budget | Max open positions total + max per tier; new entries blocked when either limit is reached |",
      "| Tier-1 symbols | BTC/USD and ETH/USD — most liquid, highest correlation. Separate per-tier budget from Tier-2 alts |",
      "| Daily drawdown gate | Equity drops ≥3% vs day-open → capital preservation mode: new entries blocked, stops tighten |",
      "| Short stop-loss / regime gate | COVER at +5% above short entry; shorts only allowed in a confirmed daily downtrend |",
      "| Live R:R | Real-time risk-to-reward: `(target − current) / (current − stop)` |",
      "",
      "---",
      "",
      "Built-in offline snapshot — the full, always-current glossary lives in `memory/glossary.md`. ↻ Refresh retries the live copy."
    ].join("\n");

    function mdInline(escaped) {
      return escaped
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    }

    // Parses a run of consecutive `| … |` lines into an HTML table, dropping
    // the markdown separator row (`|---|---|`). Returns "" if nothing usable.
    function mdTable(rows) {
      const parsed = rows
        .map(r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()))
        .filter(cells => cells.some(c => c.length));
      const dataRows = parsed.filter(cells => !cells.every(c => /^:?-{2,}:?$/.test(c)));
      if (dataRows.length < 2) return "";
      const [head, ...body] = dataRows;
      let html = '<div class="table-wrap"><table class="glossary-table"><thead><tr>' +
        head.map(h => "<th>" + mdInline(escapeHtml(h)) + "</th>").join("") + "</tr></thead><tbody>";
      body.forEach(cells => {
        const search = escapeHtml(cells.join(" ").toLowerCase());
        html += '<tr data-search="' + search + '">' +
          cells.map(c => "<td>" + mdInline(escapeHtml(c)) + "</td>").join("") + "</tr>";
      });
      return html + "</tbody></table></div>";
    }

    function renderGlossaryMarkdown(md) {
      const lines = md.split(/\r?\n/);
      let html = "";
      let tableBuf = [];
      const flushTable = () => { if (tableBuf.length) html += mdTable(tableBuf); tableBuf = []; };
      for (const line of lines) {
        if (/^\s*\|.*\|\s*$/.test(line)) { tableBuf.push(line); continue; }
        flushTable();
        if (!line.trim()) continue;
        if (/^-{3,}$/.test(line.trim())) { html += "<hr>"; continue; }
        const h3 = line.match(/^###\s+(.*)/);
        const h2 = line.match(/^##\s+(.*)/);
        const h1 = line.match(/^#\s+(.*)/);
        if (h3) { html += "<h4 class=\"glossary-h\">" + mdInline(escapeHtml(h3[1])) + "</h4>"; continue; }
        if (h2) { html += "<h3 class=\"glossary-h\">" + mdInline(escapeHtml(h2[1])) + "</h3>"; continue; }
        if (h1) { html += "<h2 class=\"glossary-h\">" + mdInline(escapeHtml(h1[1])) + "</h2>"; continue; }
        html += '<p class="glossary-p" data-search="' + escapeHtml(line.toLowerCase()) + '">' +
          mdInline(escapeHtml(line)) + "</p>";
      }
      flushTable();
      return html;
    }

    async function loadGlossary(force) {
      const list = $("glossaryList");
      if (!list) return;
      if (!force && _glossaryMd && Date.now() - _glossaryFetchedAt < GLOSSARY_CACHE_MS) {
        renderGlossary();
        return;
      }
      const st = $("glossaryStatus");
      if (st) st.textContent = "Loading…";
      const md = await fetchLocalText(["../memory/glossary.md", "./memory/glossary.md", "memory/glossary.md"]);
      _glossaryLive = !!md;
      _glossaryMd = md || GLOSSARY_FALLBACK_MD;
      _glossaryFetchedAt = Date.now();
      if (st) {
        st.textContent = _glossaryLive
          ? "Live from memory/glossary.md"
          : "Showing built-in reference — most browsers block fetching a local sibling file when " +
            "this page is opened directly (file://); serve docs/ over local HTTP for the full live " +
            "copy, or hit ↻ Refresh to retry.";
        st.style.color = _glossaryLive ? "var(--muted)" : "var(--yellow)";
      }
      renderGlossary();
    }

    function renderGlossary() {
      const list = $("glossaryList");
      if (!list || !_glossaryMd) return;
      list.innerHTML = renderGlossaryMarkdown(_glossaryMd);
      filterGlossary();
    }

    // Filters table rows and paragraphs by a case-insensitive substring match;
    // section headers always stay visible so the structure remains readable.
    function filterGlossary() {
      const list = $("glossaryList");
      if (!list) return;
      const q = (($("glossarySearch") || {}).value || "").trim().toLowerCase();
      list.querySelectorAll("[data-search]").forEach(el => {
        const match = !q || el.getAttribute("data-search").includes(q);
        el.style.display = match ? "" : "none";
      });
    }
