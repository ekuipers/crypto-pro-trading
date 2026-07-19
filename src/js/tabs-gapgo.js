
    // ═══════════════════════════════════════════════════════════════════════
    //  GAP & GO ANALYSIS ENGINE
    // ═══════════════════════════════════════════════════════════════════════

    const GG_SYMBOLS = ["BTC/USD","ETH/USD","SOL/USD","AVAX/USD","LINK/USD","DOT/USD","LTC/USD","DOGE/USD","ADA/USD","AAVE/USD"];
    const GG_DATA_BASE = "https://data.alpaca.markets";

    // Static market info (cap tier, supply inflation) — updated periodically
    const GG_MARKET_INFO = {
      "BTC/USD":  { capTier:"Mega",  capLabel:">$1T",    supplyRisk:"Low",    inflation:"~1.8%/yr (post-halving)" },
      "ETH/USD":  { capTier:"Mega",  capLabel:">$300B",  supplyRisk:"Low",    inflation:"~0.3%/yr (deflationary burn)" },
      "SOL/USD":  { capTier:"Large", capLabel:">$70B",   supplyRisk:"Medium", inflation:"~5-7%/yr staking rewards" },
      "AVAX/USD": { capTier:"Mid",   capLabel:">$12B",   supplyRisk:"Medium", inflation:"~3-5%/yr validator rewards" },
      "LINK/USD": { capTier:"Mid",   capLabel:">$10B",   supplyRisk:"Medium", inflation:"~3%/yr node operators" },
      "DOT/USD":  { capTier:"Mid",   capLabel:">$8B",    supplyRisk:"Medium", inflation:"~10%/yr staking" },
      "LTC/USD":  { capTier:"Mid",   capLabel:">$5B",    supplyRisk:"Low",    inflation:"~1.5%/yr (post-halving)" },
      "DOGE/USD": { capTier:"Mid",   capLabel:">$20B",   supplyRisk:"Medium", inflation:"~3.8B DOGE/yr (~3-4%)" },
      "ADA/USD":  { capTier:"Mid",   capLabel:">$14B",   supplyRisk:"Medium", inflation:"~2-3%/yr staking" },
      "AAVE/USD": { capTier:"Small", capLabel:">$2B",    supplyRisk:"Medium", inflation:"~3%/yr ecosystem grants" }
    };

    async function ggDataFetch(path) {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) throw new Error("Configure your Alpaca API keys in Settings first.");
      const r = await fetch(GG_DATA_BASE + path, { headers: getHeaders() });
      if (!r.ok) throw new Error(r.status + " " + r.statusText + " — " + path);
      return r.json();
    }

    // Paginated bars fetch — follows next_page_token until all symbols are complete.
    // The Alpaca multi-symbol bars API paginates by total bars across all symbols
    // (not per-symbol), so a single request for 10 symbols × 200 bars can span
    // several pages. Without pagination the response only contains the first ~1-2
    // symbols worth of data.
    async function ggFetchBarsAllPages(symbols, timeframe, start, limitPerSym) {
      const s = getSettings();
      if (!s.apiKey || !s.apiSecret) throw new Error("Configure your Alpaca API keys in Settings first.");
      const enc = symbols.map(x => encodeURIComponent(x)).join(",");
      const allBars = {};
      let pageToken = null;
      let pages = 0;
      const MAX_PAGES = 20; // safety cap

      do {
        let url = `${GG_DATA_BASE}/v1beta3/crypto/us/bars?symbols=${enc}&timeframe=${timeframe}&start=${encodeURIComponent(start)}&limit=${limitPerSym}&sort=asc`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;

        const r = await fetch(url, { headers: getHeaders() });
        if (!r.ok) throw new Error(r.status + " " + r.statusText + " fetching " + timeframe + " bars");
        const data = await r.json();

        for (const [sym, symBars] of Object.entries(data.bars || {})) {
          if (!allBars[sym]) allBars[sym] = [];
          allBars[sym].push(...symBars);
        }

        pageToken = data.next_page_token || null;
        pages++;
      } while (pageToken && pages < MAX_PAGES);

      return allBars;
    }

    // ── Indicator helpers ────────────────────────────────────────────────────

    function ggEMA(prices, period) {
      if (prices.length < period) return [];
      const k = 2 / (period + 1);
      let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
      const out = Array(period - 1).fill(null);
      out.push(ema);
      for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        out.push(ema);
      }
      return out;
    }

    function ggRSI(closes, period = 14) {
      if (closes.length < period + 1) return null;
      let g = 0, l = 0;
      for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) g += d; else l -= d;
      }
      let ag = g / period, al = l / period;
      for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * (period - 1) + Math.max(d, 0)) / period;
        al = (al * (period - 1) + Math.max(-d, 0)) / period;
      }
      return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }

    function ggATR(bars, period = 14) {
      if (bars.length < 2) return null;
      const trs = [];
      for (let i = 1; i < bars.length; i++) {
        const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
      }
      let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
      return atr;
    }

    function ggBollinger(closes, period = 20, mult = 2) {
      if (closes.length < period) return null;
      const slice = closes.slice(-period);
      const mid = slice.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
      const upper = mid + mult * std, lower = mid - mult * std;
      const last = closes[closes.length - 1];
      return { upper, mid, lower, pb: (last - lower) / (upper - lower), bw: (upper - lower) / mid };
    }

    function ggMACD(closes, fast = 12, slow = 26, sig = 9) {
      if (closes.length < slow + sig) return null;
      const eFast = ggEMA(closes, fast).filter(v => v !== null);
      const eSlow = ggEMA(closes, slow).filter(v => v !== null);
      const macdLine = eSlow.map((v, i) => eFast[i + (fast - 1)] - v).filter((_, i) => i >= slow - fast);
      const sigLine = ggEMA(macdLine, sig).filter(v => v !== null);
      const last = macdLine[macdLine.length - 1];
      const lastSig = sigLine[sigLine.length - 1];
      const prevHist = macdLine.length > 1 && sigLine.length > 1
        ? macdLine[macdLine.length - 2] - sigLine[sigLine.length - 2] : null;
      return { macd: last, signal: lastSig, hist: last - lastSig, prevHist };
    }

    function ggLevelDate(t) {
      if (!t) return "";
      const d = new Date(t);
      if (isNaN(d)) return "";
      return " · " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Etc/GMT-2" });
    }

    function ggKeyLevels(bars) {
      const highs = bars.map(b => b.h);
      const lows  = bars.map(b => b.l);
      const closes = bars.map(b => b.c);
      const current = closes[closes.length - 1];
      const max6M = Math.max(...highs), min6M = Math.min(...lows);
      const levels = [
        { price: max6M, label: "6M High",   type: "resistance" },
        { price: min6M, label: "6M Low",    type: "support" }
      ];

      // Swing highs/lows (5-bar lookback), date-stamped so multiple swings are
      // distinguishable in the Key Levels panel (Bug fix 2026-07-11)
      for (let i = 5; i < bars.length - 5; i++) {
        const when = ggLevelDate(bars[i].t);
        const h = highs[i];
        if (highs.slice(i-5,i).every(v=>v<h) && highs.slice(i+1,i+6).every(v=>v<h))
          levels.push({ price: h, label: "Swing High" + when, type: "resistance" });
        const l = lows[i];
        if (lows.slice(i-5,i).every(v=>v>l) && lows.slice(i+1,i+6).every(v=>v>l))
          levels.push({ price: l, label: "Swing Low" + when, type: "support" });
      }

      // Round-number psychological levels near current price
      const mag = Math.pow(10, Math.floor(Math.log10(current)));
      for (let m = 1; m <= 5; m++) {
        const rl = Math.round(current / (mag * m)) * mag * m;
        if (rl > min6M && rl < max6M && Math.abs(rl - current) / current < 0.15)
          levels.push({ price: rl, label: "Round Level", type: rl > current ? "resistance" : "support" });
      }

      // Deduplicate within 0.5% and keep 5 closest to current
      levels.sort((a, b) => Math.abs(a.price - current) - Math.abs(b.price - current));
      const dedup = [];
      for (const lv of levels) {
        if (!dedup.some(d => Math.abs(d.price - lv.price) / current < 0.005)) dedup.push(lv);
        if (dedup.length >= 5) break;
      }
      return dedup.sort((a, b) => b.price - a.price);
    }

    function ggGapHistory(dailyBars) {
      const samples = [];
      for (let i = 1; i < dailyBars.length - 1; i++) {
        const gap = (dailyBars[i].c - dailyBars[i - 1].c) / dailyBars[i - 1].c;
        if (Math.abs(gap) >= 0.03) {
          const intraday = (dailyBars[i].c - dailyBars[i].o) / dailyBars[i].o;
          samples.push({ gap, intraday });
        }
      }
      if (!samples.length) return { count: 0, gapGoRate: null, avgIntraday: null };
      const gg = samples.filter(s => Math.sign(s.gap) === Math.sign(s.intraday)).length;
      return {
        count: samples.length,
        gapGoRate: gg / samples.length,
        avgIntraday: samples.reduce((s, t) => s + Math.abs(t.intraday), 0) / samples.length
      };
    }

    // ── Core analyzer ────────────────────────────────────────────────────────

    function ggAnalyze(symbol, dailyBars, hourlyBars) {
      const closes  = dailyBars.map(b => b.c);
      const current = closes[closes.length - 1];
      const prev    = closes[closes.length - 2];
      const gap24h  = (current - prev) / prev;

      // Simulate 4H by sampling every 4th hourly bar
      const h4closes = hourlyBars.filter((_, i) => i % 4 === 0).map(b => b.c);

      const ema20d = ggEMA(closes, 20);
      const ema50d = ggEMA(closes, 50);
      const h4e20  = ggEMA(h4closes, 20);
      const h4e50  = ggEMA(h4closes, 50);

      const last20d = ema20d[ema20d.length - 1];
      const last50d = ema50d[ema50d.length - 1];
      const lH4e20  = h4e20[h4e20.length - 1];
      const lH4e50  = h4e50[h4e50.length - 1];

      const dailyRegime = (last20d && last50d)
        ? (current > last50d && last20d > last50d ? "uptrend"
           : current < last50d && last20d < last50d ? "downtrend" : "mixed")
        : "mixed";

      const h4Regime = (lH4e20 && lH4e50)
        ? (lH4e20 > lH4e50 ? "bullish" : "bearish")
        : "mixed";

      const rsi  = ggRSI(closes, 14);
      const atr  = ggATR(dailyBars, 14);
      const bb   = ggBollinger(closes, 20, 2);
      const macd = ggMACD(closes);

      const vols    = dailyBars.map(b => b.v);
      const avgVol  = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      const volRatio = avgVol > 0 ? vols[vols.length - 1] / avgVol : 1;

      const highs6M   = dailyBars.map(b => b.h);
      const lows6M    = dailyBars.map(b => b.l);
      const rangeHigh = Math.max(...highs6M);
      const rangeLow  = Math.min(...lows6M);
      const rangePos  = (current - rangeLow) / (rangeHigh - rangeLow);

      const keyLevels  = ggKeyLevels(dailyBars);
      const gapHistory = ggGapHistory(dailyBars);

      // ── Confluence scoring ───────────────────────────────────────────────
      let score = 0;
      const signals = [];

      // 1. 24h gap magnitude
      if      (gap24h >  0.08) { score += 2;    signals.push({ l: `Bullish gap +${(gap24h*100).toFixed(1)}% (strong)`,  v: "+2"  }); }
      else if (gap24h >  0.03) { score += 1;    signals.push({ l: `Bullish gap +${(gap24h*100).toFixed(1)}% (moderate)`, v: "+1"  }); }
      else if (gap24h < -0.08) { score -= 2;    signals.push({ l: `Bearish gap ${(gap24h*100).toFixed(1)}% (strong)`,   v: "−2"  }); }
      else if (gap24h < -0.03) { score -= 1;    signals.push({ l: `Bearish gap ${(gap24h*100).toFixed(1)}% (moderate)`, v: "−1"  }); }
      else                     {                signals.push({ l: `Flat move ${(gap24h*100).toFixed(1)}%`,               v: "0"   }); }

      // 2. Volume
      if      (volRatio >= 2.0) { score += 2;   signals.push({ l: `Volume ${volRatio.toFixed(1)}× avg (very strong)`,  v: "+2"  }); }
      else if (volRatio >= 1.3) { score += 1;   signals.push({ l: `Volume ${volRatio.toFixed(1)}× avg (above avg)`,    v: "+1"  }); }
      else if (volRatio < 0.7)  { score -= 1;   signals.push({ l: `Volume ${volRatio.toFixed(1)}× avg (weak)`,         v: "−1"  }); }
      else                      {               signals.push({ l: `Volume ${volRatio.toFixed(1)}× avg (normal)`,        v: "0"   }); }

      // 3. Daily regime
      if      (dailyRegime === "uptrend")   { score += 1; signals.push({ l: "Daily uptrend (20 EMA > 50 EMA)",    v: "+1" }); }
      else if (dailyRegime === "downtrend") { score -= 1; signals.push({ l: "Daily downtrend (20 EMA < 50 EMA)",  v: "−1" }); }
      else                                  {             signals.push({ l: "Daily mixed / sideways",             v: "0"  }); }

      // 4. 4H regime
      if      (h4Regime === "bullish") { score += 1; signals.push({ l: "4H bullish (EMA20 > EMA50)", v: "+1" }); }
      else if (h4Regime === "bearish") { score -= 1; signals.push({ l: "4H bearish (EMA20 < EMA50)", v: "−1" }); }
      else                             {             signals.push({ l: "4H mixed",                   v: "0"  }); }

      // 5. RSI
      if (rsi !== null) {
        if      (rsi > 50 && rsi < 70) { score += 0.5; signals.push({ l: `RSI ${rsi.toFixed(0)} — bullish range`,  v: "+0.5" }); }
        else if (rsi >= 70)             { score -= 0.5; signals.push({ l: `RSI ${rsi.toFixed(0)} — overbought`,     v: "−0.5" }); }
        else if (rsi < 30)              { score += 0.5; signals.push({ l: `RSI ${rsi.toFixed(0)} — oversold bounce`,v: "+0.5" }); }
        else                            {               signals.push({ l: `RSI ${rsi.toFixed(0)} — neutral`,        v: "0"    }); }
      }

      // 6. Range position
      if      (rangePos > 0.85) { score += 1;   signals.push({ l: "Near 6M high — breakout zone",         v: "+1"  }); }
      else if (rangePos < 0.15) { score += 0.5; signals.push({ l: "Near 6M low — mean-reversion possible", v: "+0.5" }); }
      else                      {               signals.push({ l: `Mid-range (${(rangePos*100).toFixed(0)}% of 6M span)`, v: "0" }); }

      // ── Derived ratings ─────────────────────────────────────────────────
      const catalystQuality = Math.abs(gap24h) > 0.08 && volRatio > 1.5 ? "Strong"
        : Math.abs(gap24h) > 0.04 || volRatio > 1.3 ? "Moderate" : "Weak";

      const catalystNote = catalystQuality === "Strong"
        ? `Large ${gap24h>0?"positive":"negative"} move (${(gap24h*100).toFixed(1)}%) on ${volRatio.toFixed(1)}× volume — genuine catalyst likely. Check news links below.`
        : catalystQuality === "Moderate"
        ? `${(gap24h*100).toFixed(1)}% 24h move — moderate catalyst signal. Confirm with news before trading.`
        : `Small move (${(gap24h*100).toFixed(1)}%) — weak or no catalyst. Primarily technical noise.`;

      const mktInfo = GG_MARKET_INFO[symbol] || { capTier:"Unknown", capLabel:"?", supplyRisk:"Medium", inflation:"Unknown" };

      const ggLikelihood = score >= 4 && dailyRegime !== "downtrend" ? "High"
        : score >= 2 ? "Medium" : "Low";

      const atrPct = atr ? atr / current : 0.05;
      const riskRating = atrPct > 0.04 || mktInfo.capTier === "Small" ? "Very High"
        : atrPct > 0.025 ? "High"
        : atrPct > 0.015 ? "Medium" : "Low";

      // ── Trade plan ──────────────────────────────────────────────────────
      const stopDist = atr ? atr * 1.5 : current * 0.03;
      let strategy, entry, stopLoss, target1, target2, sizing, riskNote;

      const nearestRes = keyLevels.find(l => l.type === "resistance" && l.price > current);
      const nearestSup = keyLevels.find(l => l.type === "support"    && l.price < current);

      if (gap24h > 0 && score >= 3 && dailyRegime !== "downtrend") {
        strategy  = rangePos > 0.8 ? "Momentum Continuation" : "Dip Buy off VWAP";
        entry     = rangePos > 0.8
          ? `Pullback or consolidation at ~${ggFmtP(current * 0.990)}; reclaim triggers continuation`
          : `VWAP hold at ~${ggFmtP(current * 0.992)} with 15-min ORB confirmation above open`;
        stopLoss  = ggFmtP(current - stopDist);
        target1   = nearestRes ? ggFmtP(nearestRes.price) : ggFmtP(current * 1.05);
        target2   = ggFmtP(current * 1.10);
        sizing    = mktInfo.capTier === "Small" ? "⚠ Reduce to 50% normal — small cap" : "Standard ATR-based sizing";
        riskNote  = "Key risk: gap fade if volume dries up at open. Honor stop.";
      } else if (gap24h < 0 && score <= -3) {
        strategy  = "Fade / Short (Mean Reversion)";
        entry     = `VWAP rejection at ~${ggFmtP(current * 1.008)} or failed breakout of open`;
        stopLoss  = ggFmtP(current + stopDist);
        target1   = nearestSup ? ggFmtP(nearestSup.price) : ggFmtP(current * 0.95);
        target2   = ggFmtP(current * 0.90);
        sizing    = "50% size — fading crypto carries gap-squeeze risk";
        riskNote  = "Key risk: gap-and-go squeeze. Use tight stop above entry candle high.";
      } else {
        strategy  = "Opening Range Breakout (ORB)";
        entry     = `5-min ORB above ${ggFmtP(current * 1.003)} (long) or below ${ggFmtP(current * 0.997)} (short)`;
        stopLoss  = `${ggFmtP(current * 0.97)} (long) / ${ggFmtP(current * 1.03)} (short)`;
        target1   = ggFmtP(current * 1.04);
        target2   = ggFmtP(current * 1.08);
        sizing    = "Half-size until breakout direction confirmed with volume";
        riskNote  = "Key risk: false breakout in low-conviction environment. Wait for strong close outside range.";
      }

      const avoidFlag = (dailyRegime === "downtrend" && gap24h < -0.02) || (score < -2);

      return {
        symbol, current, gap24h, score, catalystQuality, catalystNote,
        mktInfo, ggLikelihood, riskRating, rsi, atr, atrPct,
        bb, macd, volRatio, dailyRegime, h4Regime,
        rangeHigh, rangeLow, rangePos, keyLevels, gapHistory,
        signals, strategy, entry, stopLoss, target1, target2,
        sizing, riskNote, avoidFlag, last20d, last50d
      };
    }

    // ── Price formatter ───────────────────────────────────────────────────

    function ggFmtP(n) {
      if (n == null) return "—";
      if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
      if (n >= 1)    return "$" + n.toFixed(4);
      return "$" + n.toFixed(6);
    }

    // ── Render ────────────────────────────────────────────────────────────

    function ggRenderCards(analyses) {
      const cont = $("ggContainer");
      if (!analyses.length) { cont.innerHTML = '<div class="placeholder">No data available.</div>'; return; }

      const pill = (label, color) => `<span class="pill ${color}">${label}</span>`;
      const catC  = { Strong:"green", Moderate:"yellow", Weak:"muted" };
      const ggC   = { High:"green", Medium:"yellow", Low:"muted" };
      const riskC = { Low:"green", Medium:"yellow", High:"red", "Very High":"red" };
      const regC  = { uptrend:"green", downtrend:"red", mixed:"yellow", bullish:"green", bearish:"red" };

      let html = "";

      analyses.forEach((a, idx) => {
        const rank    = idx + 1;
        const gapPct  = (a.gap24h * 100).toFixed(2);
        const gapSign = a.gap24h >= 0 ? "+" : "";
        const gapC    = a.gap24h > 0 ? "green" : a.gap24h < 0 ? "red" : "muted";
        const rPct    = (a.rangePos * 100).toFixed(0);
        const scColor = a.score >= 3 ? "var(--green)" : a.score >= 1 ? "var(--yellow)" : "var(--red)";
        const ssColor = a.signalScore !== null ? (a.signalScore >= SIGNAL_BUY_SCORE ? "var(--green)" : a.signalScore >= SIGNAL_HALF_SCORE ? "var(--yellow)" : a.signalScore < 0 ? "var(--red)" : "var(--muted)") : "var(--muted)";
        const ssText  = a.signalScore !== null ? (a.signalScore >= 0 ? "+" : "") + a.signalScore.toFixed(1) : "–";
        const ticker  = baseTicker(a.symbol);   // news-site URL slugs need the bare base

        const newsLinks = `
          <a class="gg-news-link" href="https://cryptopanic.com/news/${ticker.toLowerCase()}/" target="_blank">CryptoPanic ↗</a>
          <a class="gg-news-link" href="https://coindesk.com/search?q=${ticker}" target="_blank">CoinDesk ↗</a>
          <a class="gg-news-link" href="https://x.com/search?q=%24${ticker}+crypto&f=live" target="_blank">X/Twitter ↗</a>
          <a class="gg-news-link" href="https://www.coingecko.com/en/coins/${ticker.toLowerCase()}" target="_blank">CoinGecko ↗</a>`;

        const levelsHtml = a.keyLevels.map(lv => {
          const dist = ((lv.price - a.current) / a.current * 100).toFixed(1);
          const sign = lv.price > a.current ? "+" : "";
          return `<div class="gg-level-row">
            <span>${pill(lv.type === "resistance" ? "RES" : "SUP", lv.type === "resistance" ? "red" : "green")} &nbsp;${lv.label}</span>
            <span class="mono" style="color:${lv.type==='resistance'?'var(--red)':'var(--green)'}">${ggFmtP(lv.price)} <span style="color:var(--muted)">(${sign}${dist}%)</span></span>
          </div>`;
        }).join("");

        const sigHtml = a.signals.map(s => {
          const isP = s.v.startsWith("+") && s.v !== "+0";
          const isN = s.v.startsWith("−") || s.v.startsWith("-");
          return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">
            <span style="color:var(--muted)">${s.l}</span>
            <span style="font-weight:900;color:${isP?"var(--green)":isN?"var(--red)":"var(--muted)"}">${s.v}</span>
          </div>`;
        }).join("");

        const maxAbsScore = 7;
        const fillW = Math.round(Math.min(Math.max((a.score + maxAbsScore) / (maxAbsScore * 2) * 100, 0), 100));
        const fillColor = a.score >= 3 ? "var(--green)" : a.score >= 1 ? "var(--yellow)" : "var(--red)";

        html += `
<div class="gg-card" style="${a.avoidFlag ? "border-color:rgba(248,81,73,.5);" : ""}">

  <div class="gg-card-header">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="gg-rank" style="${rank===1?"border-color:var(--yellow);color:var(--yellow)":""}">${rank===1?"🥇":rank}</div>
      <span class="symbol" style="font-size:20px">${tvLink(a.symbol)}</span>
      <span class="mono" style="font-size:15px">${ggFmtP(a.current)}</span>
      ${pill(gapSign + gapPct + "% 24h", gapC)}
      ${pill("Vol " + a.volRatio.toFixed(1) + "×", a.volRatio >= 1.5 ? "green" : a.volRatio >= 1.0 ? "yellow" : "muted")}
      ${a.avoidFlag ? pill("⚠ AVOID", "red") : ""}
    </div>
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div style="text-align:right">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Signal</div>
        <div style="font-size:20px;font-weight:800;color:${ssColor}">${ssText}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Conviction</div>
        <div style="font-size:26px;font-weight:950;color:${scColor}">${a.score>=0?"+":""}${a.score.toFixed(1)}</div>
        <div class="gg-score-bar" style="width:110px;margin-left:auto">
          <div class="gg-score-fill" style="width:${fillW}%;background:${fillColor}"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="gg-grid">

    <!-- CATALYST -->
    <div class="gg-section">
      <div class="gg-section-title">📰 Catalyst</div>
      <div style="font-size:12px;margin-bottom:8px;line-height:1.5">${a.catalystNote}</div>
      <div style="margin-bottom:8px">${newsLinks}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${pill("Catalyst: " + a.catalystQuality, catC[a.catalystQuality] || "muted")}</div>
    </div>

    <!-- SUPPLY & WHALE RISK -->
    <div class="gg-section">
      <div class="gg-section-title">🏦 Market Cap &amp; Supply Risk</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:3px">Cap tier: <strong style="color:var(--text)">${a.mktInfo.capTier} (${a.mktInfo.capLabel})</strong></div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Inflation: <strong style="color:var(--text)">${a.mktInfo.inflation}</strong></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${pill("Supply Risk: " + a.mktInfo.supplyRisk, { Low:"green", Medium:"yellow", High:"red" }[a.mktInfo.supplyRisk] || "muted")}
        ${pill(a.mktInfo.capTier + " Cap", ["Mega","Large"].includes(a.mktInfo.capTier) ? "green" : a.mktInfo.capTier === "Mid" ? "yellow" : "red")}
      </div>
    </div>

    <!-- GAP & GO LIKELIHOOD -->
    <div class="gg-section">
      <div class="gg-section-title">🚀 Gap &amp; Go Likelihood</div>
      <div style="margin-bottom:10px">${sigHtml}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${pill("Likelihood: " + a.ggLikelihood, ggC[a.ggLikelihood] || "muted")}
        ${pill("Daily: " + a.dailyRegime, regC[a.dailyRegime] || "muted")}
        ${pill("4H: " + a.h4Regime, regC[a.h4Regime] || "muted")}
      </div>
    </div>

    <!-- 6-MONTH RANGE -->
    <div class="gg-section">
      <div class="gg-section-title">📊 6-Month Range Position</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:2px">
        <span>6M Low</span><span>Current (${rPct}%)</span><span>6M High</span>
      </div>
      <div class="gg-range-bar">
        <div class="gg-range-cursor" style="left:${rPct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;font-family:monospace;margin-bottom:8px">
        <span style="color:var(--green)">${ggFmtP(a.rangeLow)}</span>
        <span style="color:var(--blue)">${ggFmtP(a.current)}</span>
        <span style="color:var(--red)">${ggFmtP(a.rangeHigh)}</span>
      </div>
      ${pill(a.rangePos > 0.8 ? "Near 6M High — Breakout Zone" : a.rangePos < 0.2 ? "Near 6M Low — Oversold" : "Mid-Range", a.rangePos > 0.8 ? "green" : a.rangePos < 0.2 ? "yellow" : "muted")}
    </div>

    <!-- KEY LEVELS -->
    <div class="gg-section">
      <div class="gg-section-title">🎯 Daily Chart Key Levels</div>
      ${levelsHtml || '<div style="color:var(--muted);font-size:12px">Insufficient data for level detection.</div>'}
    </div>

    <!-- HISTORICAL GAP BEHAVIOR -->
    <div class="gg-section">
      <div class="gg-section-title">📜 Historical Gap Behavior (6M)</div>
      ${a.gapHistory.count > 0 ? `
        <div style="font-size:12px;color:var(--muted);margin-bottom:3px">${a.gapHistory.count} significant moves (&gt;3%) in last 6M</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:3px">Gap-and-Go rate: <strong style="color:${a.gapHistory.gapGoRate>0.6?"var(--green)":a.gapHistory.gapGoRate>0.4?"var(--yellow)":"var(--red)"}">${(a.gapHistory.gapGoRate*100).toFixed(0)}%</strong></div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Avg intraday move on gap days: <strong style="color:var(--text)">${(a.gapHistory.avgIntraday*100).toFixed(1)}%</strong></div>
        ${pill(a.gapHistory.gapGoRate>0.6?"Tends to Gap &amp; Go":a.gapHistory.gapGoRate>0.4?"Mixed — ORB recommended":"Tends to Fade",
          a.gapHistory.gapGoRate>0.6?"green":a.gapHistory.gapGoRate>0.4?"yellow":"red")}
      ` : '<div style="font-size:12px;color:var(--muted)">Insufficient historical data for gap pattern analysis.</div>'}
    </div>

    <!-- TRADE PLAN (full width) -->
    <div class="gg-section gg-section-wide">
      <div class="gg-section-title">⚡ Trade Plan</div>
      <div class="gg-plan-grid">
        <div>
          <div class="gg-plan-item-label">Strategy</div>
          <div style="font-weight:900;color:var(--blue)">${a.strategy}</div>
        </div>
        <div>
          <div class="gg-plan-item-label">Ideal Entry</div>
          <div style="font-size:12px;line-height:1.45">${a.entry}</div>
        </div>
        <div>
          <div class="gg-plan-item-label">Stop Loss</div>
          <div class="mono" style="color:var(--red)">${a.stopLoss}</div>
        </div>
        <div>
          <div class="gg-plan-item-label">Target 1</div>
          <div class="mono" style="color:var(--green)">${a.target1}</div>
        </div>
        <div>
          <div class="gg-plan-item-label">Target 2</div>
          <div class="mono" style="color:var(--green)">${a.target2}</div>
        </div>
        <div>
          <div class="gg-plan-item-label">Position Sizing</div>
          <div style="font-size:12px;color:var(--yellow)">${a.sizing}</div>
        </div>
      </div>
      ${a.riskNote ? `<div style="margin-top:10px;font-size:11px;color:var(--muted);font-style:italic">${a.riskNote}</div>` : ""}
    </div>

    <!-- RISK RATING -->
    <div class="gg-section gg-section-wide" style="border-bottom:none">
      <div class="gg-section-title">⚠ Risk Rating</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${pill("Overall Risk: " + a.riskRating, riskC[a.riskRating] || "muted")}
        ${a.atr ? `<span style="font-size:12px;color:var(--muted)">ATR: <span class="mono">${ggFmtP(a.atr)}</span> (${(a.atrPct*100).toFixed(1)}% daily)</span>` : ""}
        ${a.rsi !== null ? `<span style="font-size:12px;color:var(--muted)">RSI: <span class="mono">${a.rsi.toFixed(1)}</span></span>` : ""}
        <span style="font-size:12px;color:var(--muted)">
          ${a.riskRating==="Very High"?"⛔ Extreme volatility — size down significantly or skip entirely."
            :a.riskRating==="High"?"⚠ High volatility — strict ATR sizing, honor stops immediately."
            :a.riskRating==="Medium"?"Standard ATR-based sizing appropriate."
            :"Lower volatility — slightly wider position size acceptable."}
        </span>
      </div>
    </div>

  </div><!-- /.gg-grid -->
</div><!-- /.gg-card -->`;
      });

      cont.innerHTML = html;
    }

    // ── Main entry point ──────────────────────────────────────────────────

    async function loadGapGo() {
      const cont = $("ggContainer");
      const upd  = $("ggLastUpdated");
      if (!cont) return;
      cont.innerHTML = '<div class="placeholder" style="padding:40px">⏳ Fetching 6-month bars for all 10 symbols… this may take a moment.</div>';
      if (upd) upd.textContent = "Loading…";

      try {
        const s = getSettings();
        if (!s.apiKey || !s.apiSecret) throw new Error("Configure Alpaca API keys in Settings first.");

        const dailyStart  = new Date(Date.now() - 185 * 86400000).toISOString().slice(0, 10);
        const hourlyStart = new Date(Date.now() -   9 * 86400000).toISOString().slice(0, 10);

        // Use paginated fetch so all 10 symbols are returned even when the API
        // splits results across multiple pages (10 symbols × 200 bars each easily
        // exceeds a single page).
        const [dBars, hBars, b15All, b4hAll] = await Promise.all([
          ggFetchBarsAllPages(GG_SYMBOLS, "1Day",  dailyStart,  200),
          ggFetchBarsAllPages(GG_SYMBOLS, "1Hour", hourlyStart, 200),
          fetchBars(GG_SYMBOLS, "15Min", 120),
          fetchBars(GG_SYMBOLS, "4Hour", 60)
        ]);
        const analyses = [];

        for (const sym of GG_SYMBOLS) {
          const daily  = dBars[sym] || [];
          const hourly = hBars[sym] || [];
          if (daily.length < 10) continue;
          try {
            const alpSym2 = sym.replace("/","");
          const b15 = ((b15All && (b15All[sym] || b15All[alpSym2])) || []).map(b => ({c:b.c,h:b.h,l:b.l,v:b.v}));
          const b4h = ((b4hAll && (b4hAll[sym] || b4hAll[alpSym2])) || []).map(b => ({c:b.c,h:b.h,l:b.l,v:b.v}));
          const bDd = daily.map(b => ({c:b.c,h:b.h,l:b.l,v:b.v}));
          const sigRes = b15.length >= STRAT_CFG.minBarsForSignal ? calcSignalScore(b15, b4h, bDd) : null;
          const ggA = ggAnalyze(sym, daily, hourly);
          ggA.signalScore = sigRes ? sigRes.score : null;
          analyses.push(ggA);
          } catch (e) {
            console.warn("GG analysis failed:", sym, e);
          }
        }

        // Sort: bullish setups (gap24h > 0) by score desc, then bearish by score desc
        analyses.sort((a, b) => {
          const sa = a.gap24h >= 0 ? a.score     : a.score - 10;
          const sb = b.gap24h >= 0 ? b.score     : b.score - 10;
          return sb - sa;
        });

        ggRenderCards(analyses);
        if (upd) upd.textContent = "Last updated: " + new Date().toLocaleTimeString();

      } catch (e) {
        cont.innerHTML = `<div class="placeholder" style="color:var(--red);padding:40px">❌ ${e.message}</div>`;
        if (upd) upd.textContent = "Error — check settings";
      }
    }
