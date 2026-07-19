
    // ── 🐦 Command › Socials (roadmap 2026-07-09; sources fixed 2026-07-10) ───
    // Crypto posts + stats from accounts with > 0.5M followers. X/Twitter has
    // no keyless API and blocks CORS, so the tab splits the job:
    //   Stats — live follower/tweet counts via the keyless fxtwitter API
    //           (api.fxtwitter.com/<handle>, ACAO:* — verified 2026-07-09).
    //   Posts — per account, in order (all through the keyless rss2json bridge
    //           the News tab uses):
    //             1. official Telegram mirror (acct.tg) via the public
    //                RSS-Bridge TelegramBridge — verified working 2026-07-10;
    //             2. Nitter-mirror RSS — best-effort only: every public mirror
    //                now bot-walls or UA-whitelists /rss (xcancel answers
    //                HTTP 200 with a fake "RSS reader not yet whitelisted!"
    //                feed — the 2026-07-10 bug rendered that as tweets, so
    //                socFetchAccount() now requires the account handle in the
    //                feed title before accepting any feed).
    //           Promise.allSettled keeps dead accounts from blanking the tab.
    // The >0.5M-follower gate is enforced by curation (SOC_ACCOUNTS); static
    // followersM snapshots are only the render fallback when fxtwitter fails.
    // Retweets and media-only Telegram posts are skipped; generalist accounts
    // (general:true) keep only crypto-keyword posts. Tier badges reuse
    // newsCatalystTier(); coin chips reuse newsDetectCoins(). Analysis-only —
    // never places orders.
    let _socItems = [];
    let _socErrors = [];
    let _socFetchedAt = 0;
    let _socFilter = "all";                    // "all" | "key" (T1/T2 only)
    let _socAcctStats = {};                    // handle → post count in feed (timeline reachable)
    let _socAcctVia = {};                      // handle → "tg" | "x" (source that served the posts)
    let _socLiveStats = {};                    // handle → { followers, tweets } from fxtwitter
    const SOC_CACHE_MS     = 10 * 60 * 1000;   // auto-load re-uses items younger than this
    const SOC_MAX_ITEMS    = 60;
    const SOC_MAX_PER_ACCT = 8;                // keep one account from flooding the feed

    // Curated accounts, every one > 0.5M followers (the roadmap gate).
    // followersM = follower count in millions, static snapshot (2026-07).
    // tg = official Telegram channel (t.me/s/<tg>) — the primary post source
    // since 2026-07-10 (X mirrors are blocked; personalities without an
    // official channel stay Nitter-best-effort with live stats via fxtwitter).
    const SOC_ACCOUNTS = [
      { h: "elonmusk",        name: "Elon Musk",         followersM: 220, general: true },
      { h: "binance",         name: "Binance",           followersM: 14, tg: "binance_announcements" },
      { h: "cz_binance",      name: "CZ",                followersM: 10 },
      { h: "coinbase",        name: "Coinbase",          followersM: 5.9 },
      { h: "VitalikButerin",  name: "Vitalik Buterin",   followersM: 5.8 },
      { h: "saylor",          name: "Michael Saylor",    followersM: 4.4 },
      { h: "justinsuntron",   name: "Justin Sun",        followersM: 3.9 },
      { h: "WatcherGuru",     name: "Watcher.Guru",      followersM: 3.4, tg: "WatcherGuru" },
      { h: "whale_alert",     name: "Whale Alert",       followersM: 2.9, tg: "whale_alert_io" },
      { h: "BitcoinMagazine", name: "Bitcoin Magazine",  followersM: 2.7 },
      { h: "Cointelegraph",   name: "Cointelegraph",     followersM: 2.3, tg: "cointelegraph" },
      { h: "APompliano",      name: "Anthony Pompliano", followersM: 1.7 },
      { h: "ErikVoorhees",    name: "Erik Voorhees",     followersM: 0.7 },
      { h: "novogratz",       name: "Mike Novogratz",    followersM: 0.6 }
    ];

    // Public Nitter mirrors, tried in order per account. Confirmed dead
    // 2026-07-13 (re-checked Bug #1): tested 8 public RSS-enabled hosts from
    // the status.d420.de tracker (xcancel.com, nitter.poast.org, nitter.net,
    // nitter.privacyredirect.com, nitter.tiekoetter.com, lightbrd.com,
    // nuku.trabun.org, nitter.space) — every one either fails to resolve/
    // connect or answers the rss2json bridge with an error / the fake
    // "RSS reader not yet whitelisted!" feed. Kept as a harmless best-effort
    // fallback (the title-verification guard below rejects the fake feed
    // instead of rendering it as tweets — see tests/test_socials_fetch.js)
    // in case a mirror recovers; the official-Telegram-mirror path above is
    // the only source that currently yields real posts.
    const SOC_NITTER_HOSTS = ["xcancel.com", "nitter.poast.org"];

    // Public RSS-Bridge instance turning t.me/s/<channel> into Atom that
    // rss2json can read (Telegram previews are HTML and CORS-blocked directly).
    function socTgFeedUrl(ch) {
      return "https://rss-bridge.org/bridge01/?action=display&bridge=TelegramBridge&username=" +
        encodeURIComponent(ch) + "&format=Atom";
    }

    // Crypto-keyword gate for generalist (non-crypto-native) accounts.
    const SOC_CRYPTO_RE = /\b(bitcoin|btc|ethereum|eth|crypto(?:currenc\w*)?|blockchain|doge(?:coin)?|solana|xrp|stablecoin|defi|nft|web3|altcoin|halving|satoshi|hodl|token|binance|coinbase|mining rig|memecoin)\b/i;

    // Nitter RSS titles carry the raw tweet text (may include HTML entities).
    function socCleanText(s) {
      const el = document.createElement("textarea");
      el.innerHTML = String(s);
      return el.value.replace(/\s+/g, " ").trim().slice(0, 280);
    }

    // Rewrite the Nitter status link back to x.com and strip the "#m" anchor.
    function socToXUrl(link, host) {
      return String(link).replace("https://" + host + "/", "https://x.com/").replace(/#m$/, "");
    }

    // Live account stats via the keyless FixTweet API (api.fxtwitter.com/<handle>,
    // Access-Control-Allow-Origin: * — verified 2026-07-09). Gives real follower
    // and total-tweet counts, so the >0.5M gate is checkable live; the static
    // followersM snapshots stay as the render fallback when this call fails.
    async function socFetchStats(acct) {
      const r = await fetch("https://api.fxtwitter.com/" + encodeURIComponent(acct.h));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (!j.user) throw new Error("no user data");
      return { followers: j.user.followers || 0, tweets: j.user.tweets || 0 };
    }

    async function socFetchAccount(acct) {
      let lastErr = null;
      // Sources in reliability order: the official Telegram mirror (when the
      // account has one) is tried before the Nitter mirrors — every public
      // Nitter instance now blocks keyless /rss readers (checked 2026-07-10).
      const sources = [];
      if (acct.tg) sources.push({ via: "tg", url: socTgFeedUrl(acct.tg), mark: "@" + acct.tg });
      for (const host of SOC_NITTER_HOSTS)
        sources.push({ via: "x", host, url: "https://" + host + "/" + acct.h + "/rss", mark: "@" + acct.h });
      for (const src of sources) {
        try {
          const r = await fetch("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(src.url));
          if (!r.ok) throw new Error("HTTP " + r.status);
          const j = await r.json();
          if (j.status !== "ok" || !(j.items || []).length) throw new Error(j.message || "empty feed");
          // Blocked mirrors answer HTTP 200 with an error feed instead of the
          // timeline (xcancel: "RSS reader not yet whitelisted!") — rendering
          // that as tweets was the 2026-07-10 bug. Both Nitter ("Name / @h")
          // and TelegramBridge ("Name (@ch) - Telegram") feed titles carry the
          // handle, so require it before accepting the feed.
          const ft = (j.feed && j.feed.title) || "";
          if (!ft.toLowerCase().includes(src.mark.toLowerCase()))
            throw new Error(/whitelist/i.test(ft) ? "mirror blocks RSS readers" : "unexpected feed: " + ft.slice(0, 60));
          return (j.items || [])
            .filter(n => !/^RT by /.test(n.title || ""))              // original tweets only
            .filter(n => !/^Please open Telegram/i.test(n.title || "")) // media-only TG posts
            .slice(0, SOC_MAX_PER_ACCT)
            .map(n => ({
              // rss2json normalizes pubDate to "YYYY-MM-DD HH:MM:SS" in UTC.
              t: new Date(String(n.pubDate || "").replace(" ", "T") + "Z").getTime() || 0,
              text: socCleanText(n.title || ""),
              url: src.via === "tg" ? String(n.link || "") : socToXUrl(n.link || "", src.host),
              via: src.via,
              acct
            }))
            .filter(it => it.text && (!acct.general || SOC_CRYPTO_RE.test(it.text)));
        } catch (e) { lastErr = e; }
      }
      throw new Error("@" + acct.h + ": " + ((lastErr && lastErr.message) || "all sources failed"));
    }

    async function loadSocials(force) {
      const list = $("socList");
      if (!list) return;
      if (!force && _socItems.length && Date.now() - _socFetchedAt < SOC_CACHE_MS) {
        renderSocials();
        return;
      }
      const st = $("socStatus");
      if (st) st.textContent = "fetching " + SOC_ACCOUNTS.length + " accounts…";
      // Timelines (Nitter mirrors, flaky) and live stats (fxtwitter, reliable)
      // fetched in parallel; each account degrades independently.
      const [results, statRes] = await Promise.all([
        Promise.allSettled(SOC_ACCOUNTS.map(a => socFetchAccount(a))),
        Promise.allSettled(SOC_ACCOUNTS.map(a => socFetchStats(a)))
      ]);
      const items = [];
      _socErrors = [];
      _socAcctStats = {};
      _socAcctVia = {};
      _socLiveStats = {};
      results.forEach((res, i) => {
        if (res.status === "fulfilled") {
          items.push(...res.value);
          _socAcctStats[SOC_ACCOUNTS[i].h] = res.value.length;
          _socAcctVia[SOC_ACCOUNTS[i].h] = (res.value[0] && res.value[0].via) || "x";
        } else {
          _socErrors.push((res.reason && res.reason.message) || String(res.reason));
        }
      });
      statRes.forEach((res, i) => {
        if (res.status === "fulfilled") _socLiveStats[SOC_ACCOUNTS[i].h] = res.value;
      });
      _socItems = items.sort((a, b) => b.t - a.t).slice(0, SOC_MAX_ITEMS)
        .map(it => Object.assign(it, { tier: newsCatalystTier(it.text), syms: newsDetectCoins(it.text) }));
      _socFetchedAt = Date.now();
      renderSocials();
    }

    function socSetFilter(f) {
      _socFilter = f;
      const all = $("socFilterAll"), key = $("socFilterKey");
      if (all) all.classList.toggle("active", f === "all");
      if (key) key.classList.toggle("active", f === "key");
      renderSocials();
    }

    // Live follower count from fxtwitter when available, else the static snapshot.
    function socFollowersM(a) {
      const live = _socLiveStats[a.h];
      return live && live.followers ? live.followers / 1e6 : a.followersM;
    }
    function socFollowersLabel(m) {
      return m >= 100 ? Math.round(m) + "M" : (Math.round(m * 10) / 10) + "M";
    }

    function renderSocials() {
      const list = $("socList");
      if (!list) return;
      // Per-account stat chips: @handle · followers (live when fxtwitter answered)
      // · tweets in feed (red ✕ when every Nitter mirror failed for the account).
      const chips = $("socAccts");
      if (chips) {
        chips.innerHTML = SOC_ACCOUNTS.map(a => {
          const n = _socAcctStats[a.h];
          const dead = !(a.h in _socAcctStats);
          const live = _socLiveStats[a.h];
          const via = _socAcctVia[a.h];
          const tip = escapeHtml(a.name) + " — " + socFollowersLabel(socFollowersM(a)) +
            " followers (" + (live ? "live via fxtwitter" + (live.tweets ? ", " + Math.round(live.tweets / 1000) + "k tweets total" : "") : "static snapshot") +
            "; curated >0.5M list)" +
            (dead ? " — X mirrors blocked, no Telegram mirror" : via === "tg" ? " — posts via official Telegram mirror" : "");
          return '<span class="soc-acct' + (dead ? " soc-dead" : "") + '" data-tip="' + tip + '"><b>@' +
            escapeHtml(a.h) + '</b><span class="soc-followers">' + socFollowersLabel(socFollowersM(a)) +
            (live ? "" : "*") + "</span>" + (dead ? "✕" : (n || 0) + (via === "tg" ? " tg" : " tw")) + "</span>";
        }).join("");
      }
      const items = _socFilter === "key" ? _socItems.filter(it => it.tier) : _socItems;
      const st = $("socStatus");
      if (st) {
        const reachable = Object.keys(_socAcctStats).length;
        const liveCount = Object.keys(_socLiveStats).length;
        const reachM = SOC_ACCOUNTS.reduce((s, a) => s + socFollowersM(a), 0);
        const at = _socFetchedAt
          ? new Date(_socFetchedAt).toLocaleTimeString("en-GB", { timeZone: "Etc/GMT-2", hour: "2-digit", minute: "2-digit" }) + " GMT+2"
          : "–";
        st.textContent = _socItems.length + " posts · " + reachable + "/" + SOC_ACCOUNTS.length +
          " timelines · stats live for " + liveCount + "/" + SOC_ACCOUNTS.length +
          " · reach ≈ " + Math.round(reachM) + "M followers · " +
          _socItems.filter(it => it.tier).length + " key · fetched " + at;
      }
      if (!items.length) {
        list.innerHTML = '<div class="small" style="color:var(--muted)">' +
          (_socItems.length ? "No T1/T2 catalyst posts right now."
            : "No posts loaded — X has no keyless API and every public Nitter mirror is " +
              "confirmed dead (checked 2026-07-13), so only accounts with an official " +
              "Telegram mirror (Binance, Watcher.Guru, Whale Alert, Cointelegraph) " +
              "currently deliver posts. Live account stats above still refresh via fxtwitter; " +
              "hit ↻ Refresh to retry all sources.") + "</div>";
        return;
      }
      list.innerHTML = items.map(it => {
        const when = new Date(it.t).toLocaleString("en-GB",
          { timeZone: "Etc/GMT-2", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        const badge = it.tier === "T1" ? '<span class="news-badge news-t1" data-tip="Structural catalyst — flag positions for close, block new entries in the symbol until resolved.">T1</span>'
                    : it.tier === "T2" ? '<span class="news-badge news-t2" data-tip="Flow catalyst — downsize or skip borderline entries, tighten attention on stops.">T2</span>'
                    : "";
        const text = it.url
          ? '<a class="news-headline" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(it.text) + "</a>"
          : escapeHtml(it.text);
        const syms = it.syms && it.syms.length
          ? ' <span class="news-syms">' + it.syms.map(s => escapeHtml(s)).join(" ") + "</span>"
          : "";
        return '<div class="news-item"><span class="news-time">' + when + '</span>' +
               '<div style="min-width:0">' + badge + text +
               ' <span class="news-src">— @' + escapeHtml(it.acct.h) + " · " +
               socFollowersLabel(socFollowersM(it.acct)) +
               (it.via === "tg" ? " · TG" : "") + "</span>" + syms + "</div></div>";
      }).join("");
    }
