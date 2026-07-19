
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


    // tvLink: wraps a symbol in a TradingView chart anchor (opens new tab).
    // Accepts BTC/USD, BTCUSD, BTC/USDT, or bare BTC. Strips the slash to the
    // TradingView ticker form (BTCUSD, BTCUSDT, …); a bare base defaults to USD.
    function tvLink(sym, label) {
      var tv = String(sym).toUpperCase().replace('/', '');
      if (!/USD[TC]?$/.test(tv)) tv += 'USD';   // bare base like "BTC" -> BTCUSD
      var url  = 'https://www.tradingview.com/chart/?symbol=CRYPTO:' + tv;
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

    function kpi(label, value, sub = "", cls = "") {
      const tip = TILE_TIPS[label] || "";
      return `
        <div class="card" ${tip ? `data-tip="${escapeHtml(tip)}"` : ""}>
          <div class="card-label">${label}</div>
          <div class="card-value ${cls}">${value}</div>
          ${sub ? `<div class="card-sub">${sub}</div>` : ""}
        </div>
      `;
    }
