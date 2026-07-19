
    // ═══════════════════════════════════════════════════════════════════════
    //  TA LIBRARY — pure functions for client-side signal computation
    // ═══════════════════════════════════════════════════════════════════════

    /** Exponential moving average array — returns same length as input (NaN-filled head).
     *  Seeded with the SMA of the first `period` values, matching Python indicators.py. */
    function emaArr(src, period) {
      const k = 2 / (period + 1);
      const out = new Array(src.length).fill(NaN);
      if (src.length < period) return out;
      // Seed with SMA of first `period` values (matches Python indicators.ema_series)
      let seed = 0;
      for (let i = 0; i < period; i++) seed += src[i];
      out[period - 1] = seed / period;
      for (let j = period; j < src.length; j++) {
        out[j] = src[j] * k + out[j - 1] * (1 - k);
      }
      return out;
    }

    /** Simple moving average array. */
    function smaArr(src, period) {
      const out = new Array(src.length).fill(NaN);
      for (let i = period - 1; i < src.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += src[j];
        out[i] = sum / period;
      }
      return out;
    }

    /** RSI(14) — returns last value. */
    function calcRSI(closes, period = 14) {
      if (closes.length < period + 1) return null;
      const diffs = closes.slice(1).map((v, i) => v - closes[i]);
      let gains = 0, losses = 0;
      for (let i = 0; i < period; i++) {
        if (diffs[i] > 0) gains += diffs[i];
        else losses -= diffs[i];
      }
      let avgGain = gains / period;
      let avgLoss = losses / period;
      for (let i = period; i < diffs.length; i++) {
        const g = diffs[i] > 0 ? diffs[i] : 0;
        const l = diffs[i] < 0 ? -diffs[i] : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
      }
      if (avgLoss === 0) return 100;
      const rs = avgGain / avgLoss;
      return 100 - 100 / (1 + rs);
    }

    /** RSI direction check: true if RSI(now) > RSI(lookback bars ago), matches Python rsi_rising(lookback=3). */
    function calcRSIRising(closes, period = 14, lookback = 3) {
      if (closes.length < period + 1 + lookback) return null;
      const rNow  = calcRSI(closes, period);
      const rPrev = calcRSI(closes.slice(0, -lookback), period);
      if (rNow === null || rPrev === null) return null;
      return rNow > rPrev;
    }

    /** MACD(12,26,9) — returns {macdLine, signalLine, histogram, prevHistogram, prevHistogram2}.
     *  prevHistogram2 is the histogram 2 bars ago, used for the 2-bar rising check
     *  that matches Python indicators.macd_hist_rising(lookback=2).
     *
     *  FIX: macdLine has NaN for the first 25 positions (ema26 only valid from index 25).
     *  Passing this NaN-prefixed array directly to emaArr() would seed the 9-bar signal
     *  EMA with NaN, making the entire signal line NaN and therefore histogram always NaN.
     *  We strip the NaN prefix, compute the compact signal EMA, then re-pad it back to
     *  full length — matching how Python _macd_components() aligns its series. */
    function calcMACD(closes) {
      if (closes.length < 35) return null;
      const ema12 = emaArr(closes, 12);
      const ema26 = emaArr(closes, 26);
      const macdLine = ema12.map((v, i) => isNaN(v) || isNaN(ema26[i]) ? NaN : v - ema26[i]);

      // Strip NaN prefix so emaArr seeds on real MACD values (matches Python alignment).
      const validMacd = macdLine.filter(v => !isNaN(v));
      const signalCompact = emaArr(validMacd, 9);
      // Re-pad to full length so index arithmetic below (last, prev, prev2) still works.
      const signalLine = new Array(macdLine.length).fill(NaN);
      const sigOffset = macdLine.length - signalCompact.length;
      signalCompact.forEach((v, i) => { signalLine[sigOffset + i] = v; });

      const last = closes.length - 1;
      const prev = last - 1;
      const prev2 = last - 2;
      const hist  = macdLine[last]  - signalLine[last];
      const hist1 = (!isNaN(macdLine[prev])  && !isNaN(signalLine[prev]))  ? macdLine[prev]  - signalLine[prev]  : NaN;
      const hist2 = (!isNaN(macdLine[prev2]) && !isNaN(signalLine[prev2])) ? macdLine[prev2] - signalLine[prev2] : NaN;
      return {
        macdLine: macdLine[last],
        signalLine: signalLine[last],
        histogram: hist,
        prevHistogram: hist1,
        prevHistogram2: hist2
      };
    }

    /** Bollinger Bands(20,2) — returns {upper, mid, lower, pb, bw} last values. */
    function calcBB(closes, period = 20, stdMult = 2) {
      if (closes.length < period) return null;
      const slice = closes.slice(-period);
      const mid = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
      const sd = Math.sqrt(variance);
      const upper = mid + stdMult * sd;
      const lower = mid - stdMult * sd;
      const last = closes[closes.length - 1];
      const pb = (upper - lower) === 0 ? 0.5 : (last - lower) / (upper - lower);
      const bw = mid !== 0 ? (upper - lower) / mid : 0;
      return { upper, mid, lower, pb, bw };
    }

    /** ATR(14) — returns last ATR value. */
    function calcATRVal(highs, lows, closes, period = 14) {
      if (highs.length < period + 1) return null;
      const trs = [];
      for (let i = 1; i < highs.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        trs.push(Math.max(hl, hc, lc));
      }
      let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
      }
      return atr;
    }

    /** Volume ratio vs 20-bar average. */
    function calcVolRatio(volumes) {
      if (volumes.length < 21) return null;
      const avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      return avg === 0 ? null : volumes[volumes.length - 1] / avg;
    }

    /** ADX(14) — Wilder trend strength (0..100), mirrors Python indicators.adx().
     *  INFORMATIONAL ONLY — never part of the 6-point calcSignalScore()
     *  (score-parity exemption, see CLAUDE.md). Display columns only. */
    function calcADX(highs, lows, closes, period = 14) {
      const n = closes.length;
      if (n < 2 * period + 1 || highs.length !== n || lows.length !== n) return null;
      const plusDm = [], minusDm = [], trs = [];
      for (let i = 1; i < n; i++) {
        const up = highs[i] - highs[i - 1];
        const down = lows[i - 1] - lows[i];
        plusDm.push(up > down && up > 0 ? up : 0);
        minusDm.push(down > up && down > 0 ? down : 0);
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
      }
      let trS = 0, pdmS = 0, mdmS = 0;
      for (let i = 0; i < period; i++) { trS += trs[i]; pdmS += plusDm[i]; mdmS += minusDm[i]; }
      const dx = [];
      for (let i = period; i < trs.length; i++) {
        trS  = trS  - trS  / period + trs[i];
        pdmS = pdmS - pdmS / period + plusDm[i];
        mdmS = mdmS - mdmS / period + minusDm[i];
        if (trS === 0) continue;
        const plusDi = 100 * pdmS / trS, minusDi = 100 * mdmS / trS;
        const diSum = plusDi + minusDi;
        if (diSum === 0) continue;
        dx.push(100 * Math.abs(plusDi - minusDi) / diSum);
      }
      if (dx.length < period) return null;
      let avg = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < dx.length; i++) avg = (avg * (period - 1) + dx[i]) / period;
      return avg;
    }

    /** Plain-language ADX strength bucket — mirrors Python indicators.adx_label(). */
    function adxLabel(v) {
      if (v == null) return "n/a";
      if (v >= 40) return "strong trend";
      if (v >= 25) return "trending";
      if (v >= 20) return "emerging trend";
      return "ranging/weak";
    }

    /** OBV trend over the last `lookback` bars — mirrors Python indicators.obv_trend().
     *  Dead zone: OBV change must exceed 5% of window volume to count as a trend.
     *  INFORMATIONAL ONLY — not scored (same exemption as ADX). */
    function calcObvTrend(closes, volumes, lookback = 20) {
      if (closes.length < 2 || closes.length !== volumes.length) return null;
      const s = [0];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) s.push(s[s.length - 1] + volumes[i]);
        else if (closes[i] < closes[i - 1]) s.push(s[s.length - 1] - volumes[i]);
        else s.push(s[s.length - 1]);
      }
      if (s.length < lookback + 1) return null;
      const delta = s[s.length - 1] - s[s.length - 1 - lookback];
      const threshold = 0.05 * volumes.slice(-lookback).reduce((a, b) => a + b, 0);
      if (delta > threshold) return "rising";
      if (delta < -threshold) return "falling";
      return "flat";
    }

    /**
     * Compute the 6-point Signal Confluence score.
     * @param bars15  array of 15-min bar objects {c, h, l, v} — at least 60 bars
     * @param bars4h  array of 4H bar objects — at least 55 bars
     * @param barsDaily array of daily bar objects — at least 55 bars
     * @returns {score, signals, regime, rsi, macd, bb, ema20, ema50, atr, volRatio}
     */
    function calcSignalScore(bars15, bars4h, barsDaily) {
      const closes = bars15.map(b => b.c);
      const highs = bars15.map(b => b.h);
      const lows = bars15.map(b => b.l);
      const vols = bars15.map(b => b.v);

      const ema20arr = emaArr(closes, 20);
      const ema50arr = emaArr(closes, 50);
      const ema20 = ema20arr[ema20arr.length - 1];
      const ema50 = ema50arr[ema50arr.length - 1];

      const rsi = calcRSI(closes);
      const rsiRising = calcRSIRising(closes);
      const macdData = calcMACD(closes);
      const bb = calcBB(closes);
      const volRatio = calcVolRatio(vols);
      const atr = calcATRVal(highs, lows, closes);

      // 4H regime
      const c4 = bars4h.map(b => b.c);
      const e4_20 = emaArr(c4, 20);
      const e4_50 = emaArr(c4, 50);
      const ema4h_20 = e4_20[e4_20.length - 1];
      const ema4h_50 = e4_50[e4_50.length - 1];

      // Daily regime
      let dailyRegime = "mixed";
      if (barsDaily && barsDaily.length >= 51) {
        const cd = barsDaily.map(b => b.c);
        const sma20d = smaArr(cd, 20);
        const sma50d = smaArr(cd, 50);
        const lastClose = cd[cd.length - 1];
        const m20 = sma20d[sma20d.length - 1];
        const m50 = sma50d[sma50d.length - 1];
        if (lastClose < m50 && m20 < m50) dailyRegime = "downtrend";
        else if (lastClose > m50 && m20 > m50) dailyRegime = "uptrend";
      }

      const signals = {};
      let score = 0;

      // 1. EMA cross (15-min) — ±0.05% dead zone matches Python indicators.ema_cross_state()
      if (!isNaN(ema20) && !isNaN(ema50)) {
        if (ema20 > ema50 * 1.0005)      { score += 1; signals.ema_cross = "+1 Golden"; }
        else if (ema20 < ema50 * 0.9995) { score -= 1; signals.ema_cross = "−1 Death"; }
        else                             { signals.ema_cross = "0 Neutral"; }
      } else {
        signals.ema_cross = "0 Neutral";
      }

      // 2. MACD histogram — partial credits match Python indicators.signal_score()
      //    +1 green & strictly rising 2 bars, +0.5 green but not rising
      //    −1 red & strictly falling 2 bars, −0.5 red but improving
      if (macdData) {
        const hasPrev2 = !isNaN(macdData.prevHistogram2);
        const strictlyRising  = hasPrev2 && macdData.histogram > macdData.prevHistogram && macdData.prevHistogram > macdData.prevHistogram2;
        const strictlyFalling = hasPrev2 && !strictlyRising;   // has data but not strictly rising
        if (macdData.histogram > 0 && strictlyRising)       { score += 1;   signals.macd = "+1 Green↑"; }
        else if (macdData.histogram < 0 && strictlyFalling) { score -= 1;   signals.macd = "−1 Red↓"; }
        else if (macdData.histogram > 0)                    { score += 0.5; signals.macd = "+0.5 Green→"; }
        else if (macdData.histogram < 0)                    { score -= 0.5; signals.macd = "−0.5 Red↑"; }
        else                                                { signals.macd = "0 Flat"; }
      } else {
        signals.macd = "0 –";
      }

      // 3. RSI — must be rising in 40–65 zone; partial −0.5 for weak+falling
      //    Matches Python indicators.signal_score() RSI logic exactly.
      if (rsi !== null) {
        if (rsi < 30)                              { score += 1;   signals.rsi = "+1 Oversold"; }
        else if (rsi > 70)                         { score -= 1;   signals.rsi = "−1 Overbought"; }
        else if (rsi >= 40 && rsi <= 65 && rsiRising === true)  { score += 1;   signals.rsi = "+1 Bullish zone↑"; }
        else if (rsi < 40 && rsiRising === false)  { score -= 0.5; signals.rsi = "−0.5 Weak↓"; }
        else                                       { signals.rsi = "0 Neutral"; }
      } else {
        signals.rsi = "0 –";
      }

      // 4. Bollinger %b
      if (bb) {
        if (bb.pb < 0.25) { score += 1; signals.bb = "+1 Near lower"; }
        else if (bb.pb > 0.75) { score -= 1; signals.bb = "−1 Near upper"; }
        else { signals.bb = "0 Mid"; }
      } else {
        signals.bb = "0 –";
      }

      // 5. Volume
      if (volRatio !== null) {
        if (volRatio >= 1.2) { score += 1; signals.volume = "+1 High vol"; }
        else if (volRatio < 0.7) { score -= 0.5; signals.volume = "−0.5 Low vol"; }
        else { signals.volume = "0 Normal"; }
      } else {
        signals.volume = "0 –";
      }

      // 6. 4H regime — same ±0.05% dead zone as Signal 1, matching Python ema_cross_state()
      if (!isNaN(ema4h_20) && !isNaN(ema4h_50)) {
        if (ema4h_20 > ema4h_50 * 1.0005)      { score += 1; signals.regime4h = "+1 Golden"; }
        else if (ema4h_20 < ema4h_50 * 0.9995) { score -= 1; signals.regime4h = "−1 Death"; }
        else                                    { signals.regime4h = "0 Neutral"; }
      } else {
        signals.regime4h = "0 –";
      }

      return {
        score: Math.round(score * 10) / 10,
        signals,
        dailyRegime,
        rsi: rsi !== null ? Math.round(rsi * 10) / 10 : null,
        macd: macdData,
        bb,
        ema20,
        ema50,
        ema4h_20,
        ema4h_50,
        atr,
        volRatio,
        lastClose: closes[closes.length - 1]
      };
    }
