
    // ── 📰 Command › News (roadmap 2026-07-09) ────────────────────────────────
    // Aggregates CORS-friendly feeds: the Alpaca News API (v1beta1/news,
    // Benzinga-sourced, uses the stored API keys) plus the CoinDesk,
    // Cointelegraph, and Decrypt RSS feeds via the keyless rss2json.com bridge
    // (Access-Control-Allow-Origin: *; direct RSS fetches are CORS-blocked in
    // the browser, and CryptoCompare/CoinGecko news now require API keys).
    // Items are merged, deduplicated by normalized headline + URL, and tagged
    // with a T1/T2 catalyst badge using keyword ladders aligned with
    // skills/crypto-catalysts. Analysis-only — never places orders.
    let _newsItems = [];
    let _newsErrors = [];
    let _newsFetchedAt = 0;
    let _newsFilter = "all";               // "all" | "key" (T1/T2 only)
    const NEWS_CACHE_MS  = 5 * 60 * 1000;  // auto-load re-uses items younger than this
    const NEWS_MAX_ITEMS = 40;

    // T1 = structural (crypto-catalysts §4): hacks/exploits, depegs, delistings,
    // enforcement naming an asset, chain halts, insolvency.
    const NEWS_T1_RE = /\b(hack(?:ed|ers?)?|exploit(?:ed)?|drain(?:ed)?|stolen|theft|breach|depeg(?:ged|s)?|de-peg|delist(?:ed|ing)?|halt(?:ed|s)? (?:trading|withdrawals|the chain)|chain halt|outage|insolven\w*|bankrupt\w*|liquidat(?:ed|ion) of|sec (?:charges|sues|lawsuit)|enforcement action|indicted|fraud charges|seiz(?:ed|ure)|sanction(?:ed|s)?|rug ?pull)\b/i;
    // T2 = flow (supply/demand for days–weeks): ETF flows/approvals, unlocks,
    // major listings, halving, treasury buys, macro prints (Fed/FOMC/CPI/rates).
    const NEWS_T2_RE = /\b(etfs?|token unlock|unlock(?:s|ing)? \$?\d|halving|listed on|lists? [A-Z]|major listing|treasury (?:buys?|purchase|adds?|sells?)|fed(?:eral reserve)?|fomc|rate (?:cut|hike|decision)|cpi|inflation (?:data|print|report)|interest rates?|strategic reserve|liquidations? top|funding rates?)\b/i;

    function newsCatalystTier(title) {
      if (NEWS_T1_RE.test(title)) return "T1";
      if (NEWS_T2_RE.test(title)) return "T2";
      return null;
    }

    async function newsFetchAlpaca() {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) return [];   // no keys — CryptoCompare still works
      const syms = getWatchlist().map(x => String(x).replace("/", "")).join(",");
      const r = await fetch(DATA_URL + "/v1beta1/news?symbols=" + encodeURIComponent(syms) + "&limit=50&sort=desc",
                            { headers: getHeaders() });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return (j.news || []).map(n => ({
        t: new Date(n.created_at || 0).getTime(),
        title: n.headline || "",
        url: n.url || "",
        source: n.source ? n.source.charAt(0).toUpperCase() + n.source.slice(1) : "Benzinga",
        syms: (n.symbols || []).map(x => String(x).replace(/USD[TC]?$/, "")).slice(0, 4)
      }));
    }

    const NEWS_RSS_FEEDS = [
      { name: "CoinDesk",      url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
      { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
      { name: "Decrypt",       url: "https://decrypt.co/feed" }
    ];

    // Base tickers detected in a headline (watchlist majors + XRP). Used for the
    // symbol chips on RSS items, which carry no ticker metadata of their own.
    // Case-sensitive on the ticker form so "Sol"/"Ada" in ordinary words never
    // match; the full coin name matches in any casing.
    const NEWS_COIN_RES = [
      ["BTC", /\b[Bb]itcoin\b|\bBTC\b/],     ["ETH", /\b[Ee]thereum\b|\b[Ee]ther\b|\bETH\b/],
      ["SOL", /\b[Ss]olana\b|\bSOL\b/],      ["XRP", /\bXRP\b|\b[Rr]ipple\b/],
      ["ADA", /\b[Cc]ardano\b|\bADA\b/],     ["DOGE", /\b[Dd]ogecoin\b|\bDOGE\b/],
      ["AVAX", /\b[Aa]valanche\b|\bAVAX\b/], ["LINK", /\b[Cc]hainlink\b|\bLINK\b/],
      ["DOT", /\b[Pp]olkadot\b|\bDOT\b/],    ["LTC", /\b[Ll]itecoin\b|\bLTC\b/],
      ["AAVE", /\b[Aa]ave\b|\bAAVE\b/]
    ];
    function newsDetectCoins(text) {
      return NEWS_COIN_RES.filter(([, re]) => re.test(text)).map(([sym]) => sym).slice(0, 4);
    }

    async function newsFetchRss(feed) {
      const r = await fetch("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed.url));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.status !== "ok") throw new Error(j.message || "feed error");
      return (j.items || []).map(n => ({
        // rss2json normalizes pubDate to "YYYY-MM-DD HH:MM:SS" in UTC.
        t: new Date(String(n.pubDate || "").replace(" ", "T") + "Z").getTime() || 0,
        title: n.title || "",
        url: n.link || "",
        source: feed.name,
        syms: newsDetectCoins((n.title || "") + " " + (n.categories || []).join(" "))
      }));
    }

    function newsNormTitle(s) {
      return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    }

    // Dedupe across sources: newest first, drop items whose normalized headline
    // (first 80 chars — catches punctuation/casing variants) or URL was seen.
    function newsDedupe(items) {
      const seen = new Set();
      const out = [];
      for (const it of items.slice().sort((a, b) => b.t - a.t)) {
        if (!it.title) continue;
        const key = newsNormTitle(it.title).slice(0, 80);
        if (seen.has(key) || (it.url && seen.has(it.url))) continue;
        seen.add(key);
        if (it.url) seen.add(it.url);
        out.push(it);
      }
      return out;
    }

    async function loadNews(force) {
      const list = $("newsList");
      if (!list) return;
      if (!force && _newsItems.length && Date.now() - _newsFetchedAt < NEWS_CACHE_MS) {
        renderNews();
        return;
      }
      const st = $("newsStatus");
      if (st) st.textContent = "fetching…";
      const results = await Promise.allSettled(
        [newsFetchAlpaca()].concat(NEWS_RSS_FEEDS.map(f => newsFetchRss(f))));
      const names = ["Alpaca/Benzinga"].concat(NEWS_RSS_FEEDS.map(f => f.name));
      const items = [];
      _newsErrors = [];
      results.forEach((res, i) => {
        if (res.status === "fulfilled") items.push(...res.value);
        else _newsErrors.push(names[i] + ": " + ((res.reason && res.reason.message) || res.reason));
      });
      _newsItems = newsDedupe(items).slice(0, NEWS_MAX_ITEMS)
        .map(it => Object.assign(it, { tier: newsCatalystTier(it.title) }));
      _newsFetchedAt = Date.now();
      renderNews();
    }

    function newsSetFilter(f) {
      _newsFilter = f;
      const all = $("newsFilterAll"), key = $("newsFilterKey");
      if (all) all.classList.toggle("active", f === "all");
      if (key) key.classList.toggle("active", f === "key");
      renderNews();
    }

    function renderNews() {
      const list = $("newsList");
      if (!list) return;
      const items = _newsFilter === "key" ? _newsItems.filter(it => it.tier) : _newsItems;
      const st = $("newsStatus");
      if (st) {
        const srcCount = new Set(_newsItems.map(it => it.source)).size;
        const at = _newsFetchedAt
          ? new Date(_newsFetchedAt).toLocaleTimeString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", minute: "2-digit" }) + " GMT+2"
          : "–";
        st.textContent = _newsItems.length + " headlines · " + srcCount + " sources · " +
          _newsItems.filter(it => it.tier).length + " key · fetched " + at +
          (_newsErrors.length ? " · ⚠ " + _newsErrors.join(" · ") : "");
      }
      if (!items.length) {
        list.innerHTML = '<div class="small" style="color:var(--muted)">' +
          (_newsItems.length ? "No T1/T2 catalyst headlines right now." : "No news loaded — check API keys or hit ↻ Refresh.") + "</div>";
        return;
      }
      list.innerHTML = items.map(it => {
        const when = new Date(it.t).toLocaleString("en-GB",
          { timeZone: "Etc/GMT-2", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        const badge = it.tier === "T1" ? '<span class="news-badge news-t1" data-tip="Structural catalyst — flag positions for close, block new entries in the symbol until resolved.">T1</span>'
                    : it.tier === "T2" ? '<span class="news-badge news-t2" data-tip="Flow catalyst — downsize or skip borderline entries, tighten attention on stops.">T2</span>'
                    : "";
        const headline = it.url
          ? '<a class="news-headline" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(it.title) + "</a>"
          : escapeHtml(it.title);
        const syms = it.syms && it.syms.length
          ? ' <span class="news-syms">' + it.syms.map(s => escapeHtml(s)).join(" ") + "</span>"
          : "";
        return '<div class="news-item"><span class="news-time">' + when + '</span>' +
               '<div style="min-width:0">' + badge + headline +
               ' <span class="news-src">— ' + escapeHtml(it.source) + "</span>" + syms + "</div></div>";
      }).join("");
    }
