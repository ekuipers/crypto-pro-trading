
    // ── 📖 Command › Glossary (roadmap 2026-07-18; DB-backed 2026-07-24) ──────
    // Renders the glossary straight into the dashboard so trading terms,
    // acronyms, and dated feature notes are one click away from the tabs that
    // use them, instead of living only in the repo. A tiny markdown subset is
    // supported (headers, tables, `**bold**`, `` `code` ``, `---` rules) since
    // that's all glossary.md (the underlying content) uses. Read-only
    // reference — never places orders. Suite roadmap: "Add glossary to the
    // database instead of loading it from a file" — server.js now syncs
    // memory/glossary.md into Postgres on boot and GET /api/glossary serves
    // that row (src/glossaryRoutes.js), fixing a latent production bug where
    // the file was never statically served at all, so the live dashboard was
    // silently stuck on the small hardcoded fallback below.
    let _glossaryMd = "";
    let _glossaryFetchedAt = 0;
    let _glossaryLive = false;   // true once a real fetch of the glossary succeeds
    let _glossaryLang = null;    // language the cached copy is in
    let _glossaryServedLang = null;  // language the server actually returned
    const GLOSSARY_CACHE_MS = 5 * 60 * 1000;

    // Deliberately English-only, and the status line says so. This is the
    // last-resort snapshot for when the server cannot be reached at all;
    // carrying four copies of it in the bundle to cover an offline edge case
    // would cost every user bytes on every load to translate a screen that
    // already announces itself as a degraded fallback.
    //
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
      "| Hard cap | Per-symbol position cap from `config.json › portfolio_caps.caps`, enforced on every order |",
      "| ATR sizing | 1% risk rule: qty = (equity×1%) / (ATR×1.5), capped at the symbol's cap. The 1% is nominal — the exit stop is the 4H swing low, typically much further away, so a loss can cost more than 1% |",
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
      "Built-in offline snapshot — the full, always-current glossary is served from the database via `/api/glossary`. ↻ Refresh retries the live copy."
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
      const lang = ttLang();
      // The cache is per language: a language switch must refetch even inside
      // the TTL, otherwise the tab keeps serving the previous language's copy.
      const fresh = _glossaryMd && _glossaryLang === lang &&
        Date.now() - _glossaryFetchedAt < GLOSSARY_CACHE_MS;
      if (!force && fresh) {
        renderGlossary();
        return;
      }
      const st = $("glossaryStatus");
      if (st) st.textContent = tt("rtc", "loading", "Loading…");
      const data = await fetchLocalJson(["/api/glossary?lang=" + encodeURIComponent(lang)]);
      const md = data && data.content;
      _glossaryLive = !!md;
      _glossaryMd = md || GLOSSARY_FALLBACK_MD;
      _glossaryLang = lang;
      _glossaryServedLang = (data && data.lang) || null;
      _glossaryFetchedAt = Date.now();
      renderGlossaryStatus();
      renderGlossary();
    }

    // Split out so a language switch can re-label the status line without
    // refetching, and so the offline-fallback warning is itself translated.
    function renderGlossaryStatus() {
      const st = $("glossaryStatus");
      if (!st) return;
      if (!_glossaryLive) {
        st.textContent = tt("glossary", "rtOffline",
          "Showing the built-in English reference — /api/glossary didn't respond (server unreachable, " +
          "or the database isn't configured yet); hit ↻ Refresh to retry.");
        st.style.color = "var(--yellow)";
        return;
      }
      // The server falls back to English when a translation row hasn't synced
      // yet. Say so rather than letting the tab look untranslated for no
      // visible reason — the honest message is the difference between "this
      // is broken" and "this one language is still catching up".
      if (_glossaryServedLang && _glossaryServedLang !== _glossaryLang) {
        st.textContent = tt("glossary", "rtLangFallback",
          "Live from database — showing English, the {{lang}} glossary hasn't synced yet.",
          { lang: (_glossaryLang || "").toUpperCase() });
        st.style.color = "var(--yellow)";
        return;
      }
      st.textContent = tt("glossary", "rtLive", "Live from database");
      st.style.color = "var(--muted)";
    }

    // #glossaryList and #glossaryStatus are script-written, so applyDomI18n()
    // cannot reach them — and unlike every other tab the *content itself* is
    // per language, so this refetches rather than just re-rendering. Gated on
    // the sub-tab being open, same as the Scheduled Jobs panel: there is no
    // reason to spend a request on a panel nobody is looking at, and nav.js
    // calls loadGlossary() on open anyway, which will see the language change
    // through the per-language cache check.
    onLangChange("command", function () {
      if (_commandSub === "glossary") loadGlossary();
    });

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
