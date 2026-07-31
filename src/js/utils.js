
    let activeTab = "command";
    let equityChart = null;
    let returnsChart = null;
    let drawdownChart = null;
    let lastContext = null;
    let autoRefreshTimer = null;
    const DATA_URL   = "https://data.alpaca.markets";
    let _tickerTimer = null;     // independent 15s ticker interval

    function $(id) {
      return document.getElementById(id);
    }

    // ---------------------------------------------------------------------
    // Runtime i18n for the classic dashboard scripts (roadmap item 8).
    //
    // applyDomI18n() only reaches markup that carries a data-i18n* attribute,
    // so it covers the static tab fragments and nothing else. Everything the
    // tabs-*.js scripts write into innerHTML/textContent at runtime -- table
    // bodies, KPI tiles, status text, tooltips -- has to be translated here
    // instead. tabs-command.js's Scheduled Jobs panel was the worked example
    // this generalises.
    //
    // `fallback` is the English literal that used to be hardcoded at the call
    // site. It is not decoration: the tab scripts are plain <script> tags
    // loaded by scriptLoader.js and can run before (or without) i18n having
    // initialised, and a failed locale fetch must degrade to readable English
    // rather than to an empty cell or a raw key.
    function tt(ns, key, fallback, vars) {
      if (typeof window.t !== "function") return fallback;
      return window.t(ns + "." + key, Object.assign(
        { ns: "app", defaultValue: fallback },
        vars || {}
      ));
    }

    // Re-render hook for a panel that owns script-written DOM. `tabs` is the
    // activeTab id (or ids) this panel belongs to -- a language switch must not
    // trigger a refetch for a tab nobody is looking at, since most of these
    // render functions hit the Alpaca API. Panels that keep a cache should
    // re-render from it rather than passing their loader here.
    function onLangChange(tabs, fn) {
      const want = Array.isArray(tabs) ? tabs : [tabs];
      document.addEventListener("lang-changed", function () {
        if (want.indexOf(activeTab) !== -1) fn();
      });
    }

    // Values that ta-lib.js / the engine emit as *data*, translated only at
    // render time. Never translate them at the source: signalScore() and
    // calcSignalScore() are diffed string-for-string by src/scoreParity.test.js,
    // so a localised "uptrend" would fail parity against the Node engine -- and
    // the engine is what actually trades.
    // `vocab`, not `common`: there is a separate top-level `common` i18n
    // namespace (the modals/header/footer file), and these live in `app`.
    function ttRegime(v) {
      if (!v) return "–";
      return tt("vocab", "regime" + v.charAt(0).toUpperCase() + v.slice(1), v);
    }

    function ttTrendWord(v) {
      if (!v) return "–";
      return tt("vocab", "trend" + v.charAt(0).toUpperCase() + v.slice(1), v);
    }

    // adxLabel() returns prose ("emerging trend", "ranging/weak"). ADX is a
    // documented parity exemption (informational, never scored), but it is
    // still translated at render time rather than at source so ta-lib.js stays
    // a pure, locale-free module like indicators.js.
    const ADX_LABEL_KEYS = {
      "n/a": "adxNa",
      "strong trend": "adxStrong",
      "trending": "adxTrending",
      "emerging trend": "adxEmerging",
      "ranging/weak": "adxRanging"
    };

    function ttAdxLabel(v) {
      const en = adxLabel(v);
      return tt("vocab", ADX_LABEL_KEYS[en] || "adxNa", en);
    }

    // Weekday and month names come from Intl in the active language rather than
    // from the locale files -- they are calendar data, not copy, and hand-listing
    // them four times is how a translated dashboard ends up with English "Mon".
    // Note this is deliberately NOT used for the GMT+2 job timestamps in
    // tabs-command.js, which stay en-GB so the fixed-width column keeps aligning.
    function ttLang() {
      return (window.i18n && window.i18n.language) || "en";
    }

    // Sunday-first, matching Date#getDay() indexing.
    function ttWeekdays(width) {
      const fmtW = new Intl.DateTimeFormat(ttLang(), { weekday: width || "short", timeZone: "UTC" });
      const out = [];
      for (let d = 0; d < 7; d++) {
        // 2023-01-01 was a Sunday.
        out.push(fmtW.format(new Date(Date.UTC(2023, 0, 1 + d))));
      }
      return out;
    }

    function ttMonthLabel(year, month) {
      return new Date(year, month, 1).toLocaleString(ttLang(), { month: "short", year: "numeric" });
    }

    function fmt(n, dec = 2) {
      if (n == null || isNaN(n)) return "–";
      return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec
      }).format(Number(n));
    }

    function fmtPrice(n) {
      if (n == null || isNaN(n)) return "–";
      const v = Number(n);
      return "$" + fmt(v, Math.abs(v) < 1 ? 6 : 2);
    }

    function plClass(n) {
      if (n == null || isNaN(n)) return "neu";
      return Number(n) >= 0 ? "pos" : "neg";
    }

    function plSign(n) {
      if (n == null || isNaN(n)) return "–";
      const v = Number(n);
      return (v >= 0 ? "+" : "-") + "$" + fmt(Math.abs(v));
    }

    function pct(n, dec = 2, signed = true) {
      if (n == null || isNaN(n)) return "–";
      const v = Number(n);
      return (signed && v >= 0 ? "+" : "") + fmt(v, dec) + "%";
    }


    // tvLink: wraps a symbol in a CryptoPro Charts chart anchor (opens new tab).
    // Accepts BTC/USD, BTCUSD, BTC/USDT, or bare BTC. Strips the slash to the
    // exchange ticker form (BTCUSD, BTCUSDT, …) Charts' router expects in
    // ?symbol=; a bare base defaults to USD.
    //
    // exchange=alpaca is pinned explicitly (Suite bug, 2026-07-20): Charts'
    // router applied the URL symbol straight to its default exchange
    // (binance/bybit), which lists alts in USDT, not USD — every Trader deep
    // link (always USD-quoted, since Alpaca is USD-only) silently failed to
    // load unless the user had separately added a USDT-quoted version of the
    // same symbol to Charts' own watchlist. Alpaca is the venue Trader
    // actually trades on and is genuinely USD-quoted, so pinning it makes
    // every link resolve regardless of Charts' default exchange/watchlist.
    function tvLink(sym, label) {
      var tv = String(sym).toUpperCase().replace('/', '');
      if (!/USD[TC]?$/.test(tv)) tv += 'USD';   // bare base like "BTC" -> BTCUSD
      var url  = 'https://charts.cryptoprosuite.com/?symbol=' + tv + '&exchange=alpaca';
      var txt  = (label !== undefined) ? label : sym;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="tv-link">' + txt + '</a>';
    }

    // baseTicker: the base asset of a pair regardless of quote currency
    // (BTC/USD -> BTC, BTC/USDT -> BTC, bare BTC -> BTC). Canonical symbol
    // notation is the full BASE/QUOTE pair (roadmap 2026-07-09) — this helper
    // is NOT for symbol labels. Remaining uses are functional: external news
    // URL slugs (CoinGecko/CryptoPanic want the base) and the space-capped
    // correlation-matrix axis ticks.
    function baseTicker(sym) {
      return String(sym).split("/")[0];
    }

    function toSlash(sym) {
      if (!sym) return "–";
      if (sym.includes("/")) return sym;
      // attach the longest matching allowed quote (USDT/USDC before USD) so
      // bare Alpaca symbols like BTCUSD / BTCUSDT normalize to BASE/QUOTE
      const q = ["USDT", "USDC", "USD"].find(function(qq) { return sym.endsWith(qq); });
      return q ? sym.slice(0, -q.length) + "/" + q : sym;
    }

    function timeAgo(iso) {
      if (!iso) return "–";
      const d = (Date.now() - new Date(iso).getTime()) / 1000;
      if (d < 60) return Math.round(d) + "s ago";
      if (d < 3600) return Math.round(d / 60) + "m ago";
      if (d < 86400) return Math.round(d / 3600) + "h ago";
      return new Date(iso).toLocaleDateString();
    }

    function escapeHtml(s) {
      return String(s || "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");
    }

    function showError(msg) {
      $("globalError").style.display = "block";
      $("globalError").textContent = "⚠ " + msg;
    }

    function clearError() {
      $("globalError").style.display = "none";
      $("globalError").textContent = "";
    }

    function pill(level, text) {
      return '<span class="pill ' + level + '">' + text + '</span>';
    }

    // English label -> locale key. The label doubles as the TILE_TIPS lookup
    // key, so translation happens *inside* kpi() rather than at the ~80 call
    // sites: callers keep passing the English literal, which stays both the
    // TILE_TIPS key and the fallback. Translating at the call sites instead
    // would have silently blanked every tile tooltip in NL/FR/ES, because
    // TILE_TIPS[<translated label>] is undefined.
    function tileKey(label) {
      return String(label)
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join("");
    }

    function kpi(label, value, sub = "", cls = "") {
      const enTip = TILE_TIPS[label] || "";
      const key = tileKey(label);
      const shown = tt("tiles", key, label);
      const tip = enTip ? tt("tiles", key + "Tip", enTip) : "";
      return `
        <div class="card" ${tip ? `data-tip="${escapeHtml(tip)}"` : ""}>
          <div class="card-label">${shown}</div>
          <div class="card-value ${cls}">${value}</div>
          ${sub ? `<div class="card-sub">${sub}</div>` : ""}
        </div>
      `;
    }
