// src/indicators.js
//
// Pure-function technical indicators — a faithful port of scripts/indicators.py.
// No network, no Alpaca-specific code: takes arrays of OHLCV data (oldest -> newest)
// and returns numbers / small tuples (as plain arrays or objects).
//
// Used to score each symbol's bullish/bearish stance per the trading skill's
// 6-point Signal Confluence Table. Kept in exact numeric parity with the Python
// module — see the "Python <-> Node parity" note in CLAUDE.md before changing
// any formula here without changing scripts/indicators.py too.
//
// Conventions:
//   - All inputs are oldest-first arrays of numbers.
//   - All "current" values are the most recent (values[values.length - 1]).
//   - Functions return null when there is not enough history rather than throwing.

// ---------- moving averages ------------------------------------------------

export function sma(values, window) {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / window;
}

/**
 * Full EMA series, seeded with the SMA of the first `period` values.
 * Returned series is values.length - period + 1 long.
 */
export function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2.0 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [seed];
  for (let i = period; i < values.length; i++) {
    out.push(out[out.length - 1] * (1 - k) + values[i] * k);
  }
  return out;
}

export function ema(values, period) {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

/**
 * 'golden' if fast EMA > slow EMA (bullish uptrend), 'death' if fast EMA <
 * slow EMA (bearish downtrend), or 'neutral'. Used as the 20 EMA > 50 EMA
 * confluence point from the trading skill. ±0.05% dead zone.
 */
export function emaCrossState(closes, fast = 20, slow = 50) {
  if (closes.length < slow + 1) return null;
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  if (f === null || s === null) return null;
  if (f > s * 1.0005) return "golden";
  if (f < s * 0.9995) return "death";
  return "neutral";
}

// ---------- ATR (Average True Range) ---------------------------------------

/**
 * Wilder's Average True Range. Measures volatility — used for ATR-based
 * stop sizing (entry ± 1.5-2x ATR per the trading skill).
 */
export function atr(highs, lows, closes, period = 14) {
  if (
    closes.length < period + 1 ||
    highs.length !== closes.length ||
    lows.length !== closes.length
  ) {
    return null;
  }
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  if (trs.length < period) return null;
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
  }
  return avg;
}

// ---------- ADX (Average Directional Index) --------------------------------

/**
 * Wilder's ADX — trend *strength* (0..100), direction-agnostic. Complements
 * the EMA cross (which gives direction but not strength). Informational
 * only — not part of the 6-point signalScore.
 */
export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < 2 * period + 1 || highs.length !== n || lows.length !== n) return null;
  const plusDm = [];
  const minusDm = [];
  const trs = [];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDm.push(up > down && up > 0 ? up : 0.0);
    minusDm.push(down > up && down > 0 ? down : 0.0);
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  let trS = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let pdmS = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let mdmS = minusDm.slice(0, period).reduce((a, b) => a + b, 0);
  const dxValues = [];
  for (let i = period; i < trs.length; i++) {
    trS = trS - trS / period + trs[i];
    pdmS = pdmS - pdmS / period + plusDm[i];
    mdmS = mdmS - mdmS / period + minusDm[i];
    if (trS === 0) continue;
    const plusDi = (100.0 * pdmS) / trS;
    const minusDi = (100.0 * mdmS) / trS;
    const diSum = plusDi + minusDi;
    if (diSum === 0) continue;
    dxValues.push((100.0 * Math.abs(plusDi - minusDi)) / diSum);
  }
  if (dxValues.length < period) return null;
  let avg = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    avg = (avg * (period - 1) + dxValues[i]) / period;
  }
  return avg;
}

/** Plain-language strength bucket for an ADX value. */
export function adxLabel(value) {
  if (value === null || value === undefined) return "n/a";
  if (value >= 40) return "strong trend";
  if (value >= 25) return "trending";
  if (value >= 20) return "emerging trend";
  return "ranging/weak";
}

// ---------- OBV (On-Balance Volume) -----------------------------------------

/**
 * On-Balance Volume series: cumulative volume signed by the close-to-close
 * direction. Rising OBV = accumulation; falling = distribution.
 */
export function obvSeries(closes, volumes) {
  if (closes.length < 2 || closes.length !== volumes.length) return [];
  const out = [0.0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) out.push(out[out.length - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) out.push(out[out.length - 1] - volumes[i]);
    else out.push(out[out.length - 1]);
  }
  return out;
}

/**
 * 'rising' / 'falling' / 'flat' — direction of cumulative volume flow over the
 * last `lookback` bars. Dead zone: the OBV change must exceed 5% of the total
 * volume traded in the window to count as a trend. Informational only.
 */
export function obvTrend(closes, volumes, lookback = 20) {
  const s = obvSeries(closes, volumes);
  if (s.length < lookback + 1) return null;
  const delta = s[s.length - 1] - s[s.length - 1 - lookback];
  const threshold = 0.05 * volumes.slice(-lookback).reduce((a, b) => a + b, 0);
  if (delta > threshold) return "rising";
  if (delta < -threshold) return "falling";
  return "flat";
}

// ---------- RSI --------------------------------------------------------------

/** Wilder's RSI. Returns the most recent RSI value (0..100) or null. */
export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  const gains = [];
  const losses = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gains.push(d > 0 ? d : 0.0);
    losses.push(d < 0 ? -d : 0.0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return avgGain > 0 ? 100.0 : 50.0;
  const rs = avgGain / avgLoss;
  return 100.0 - 100.0 / (1.0 + rs);
}

/** True if the RSI has been rising over the last `lookback` bars. */
export function rsiRising(values, period = 14, lookback = 3) {
  if (values.length < period + 1 + lookback) return null;
  const rNow = rsi(values, period);
  const rPrev = rsi(values.slice(0, values.length - lookback), period);
  if (rNow === null || rPrev === null) return null;
  return rNow > rPrev;
}

// ---------- MACD ---------------------------------------------------------------

function macdComponents(values, fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal) return null;
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  if (!fastSeries.length || !slowSeries.length) return null;
  const offset = slow - fast;
  const macdSeries = fastSeries
    .slice(offset)
    .map((f, i) => f - slowSeries[i]);
  const signalSeries = emaSeries(macdSeries, signal);
  if (!signalSeries.length) return null;
  const macdAligned = macdSeries.slice(macdSeries.length - signalSeries.length);
  const histSeries = macdAligned.map((m, i) => m - signalSeries[i]);
  return [macdAligned, signalSeries, histSeries];
}

/** Most recent [macdLine, signalLine, histogram] or null. */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const c = macdComponents(values, fast, slow, signal);
  if (c === null) return null;
  const [macdS, sigS, histS] = c;
  return [macdS[macdS.length - 1], sigS[sigS.length - 1], histS[histS.length - 1]];
}

/**
 * Detect a histogram sign change between the previous bar and the current
 * bar. 'bullish' if hist crossed up through 0, 'bearish' if down, else null.
 */
export function macdFlip(values, fast = 12, slow = 26, signal = 9) {
  const c = macdComponents(values, fast, slow, signal);
  if (c === null) return null;
  const histS = c[2];
  if (histS.length < 2) return null;
  const prev = histS[histS.length - 2];
  const curr = histS[histS.length - 1];
  if (prev <= 0 && curr > 0) return "bullish";
  if (prev >= 0 && curr < 0) return "bearish";
  return null;
}

/** True if the MACD histogram has been rising for `lookback` bars. */
export function macdHistRising(values, fast = 12, slow = 26, signal = 9, lookback = 2) {
  const c = macdComponents(values, fast, slow, signal);
  if (c === null) return null;
  const histS = c[2];
  if (histS.length < lookback + 1) return null;
  for (let i = 0; i < lookback; i++) {
    const a = histS[histS.length - (lookback - i) - 1];
    const b = histS[histS.length - (lookback - i)];
    if (!(b > a)) return false;
  }
  return true;
}

// ---------- Bollinger Bands ------------------------------------------------

/**
 * Most recent [lower, middle, upper, bandwidth, percentB] or null.
 *   bandwidth = (upper - lower) / middle
 *   percentB  = (last - lower) / (upper - lower)
 */
export function bollinger(values, period = 20, numStd = 2.0) {
  if (values.length < period) return null;
  const window = values.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((acc, x) => acc + (x - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = middle + numStd * sd;
  const lower = middle - numStd * sd;
  const bandwidth = middle ? (upper - lower) / middle : 0.0;
  const last = values[values.length - 1];
  const pb = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return [lower, middle, upper, bandwidth, pb];
}

function bandwidthAt(values, endIdx, period = 20) {
  if (endIdx < period) return null;
  const w = values.slice(endIdx - period, endIdx);
  const m = w.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(w.reduce((acc, x) => acc + (x - m) ** 2, 0) / period);
  return m ? (2 * sd) / m : 0.0;
}

/** Compare current bandwidth to bandwidth `lookback` bars ago. */
export function bollingerTrend(values, period = 20, lookback = 10) {
  if (values.length < period + lookback) return null;
  const cur = bandwidthAt(values, values.length, period);
  const prev = bandwidthAt(values, values.length - lookback, period);
  if (cur === null || prev === null) return null;
  if (cur > prev * 1.05) return "widening";
  if (cur < prev * 0.95) return "tightening";
  return "stable";
}

/**
 * True if current bandwidth sits in the bottom `percentile` of the last
 * `lookback` bars — i.e. the bands are tight by historical standards.
 */
export function bollingerSqueeze(values, period = 20, lookback = 60, percentile = 20) {
  if (values.length < period + lookback) return null;
  const bws = [];
  for (let end = values.length - lookback; end <= values.length; end++) {
    const bw = bandwidthAt(values, end, period);
    if (bw !== null) bws.push(bw);
  }
  if (bws.length < 5) return null;
  const cur = bws[bws.length - 1];
  const sorted = [...bws].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor((sorted.length * percentile) / 100.0) - 1);
  const threshold = sorted[idx];
  return cur <= threshold;
}

// ---------- Volume -----------------------------------------------------------

/**
 * Current volume / average of the previous `period` bars. > 1.0 means
 * above-average volume on the current bar (a positive signal).
 */
export function volumeRatio(volumes, period = 20) {
  if (volumes.length < period + 1) return null;
  const window = volumes.slice(-(period + 1), -1);
  const avg = window.reduce((a, b) => a + b, 0) / period;
  if (avg === 0) return null;
  return volumes[volumes.length - 1] / avg;
}

// ---------- 6-Point Confluence Score (per trading skill) --------------------

/**
 * 6-point Signal Confluence Table from the trading skill's Quick Reference.
 * Each of the 6 conditions is worth 1 point (bullish) or -1 point (bearish).
 * Net score range: -6 to +6.
 *
 * Returns { score, parts } — parts keys: emaCross, macd, rsi, bb, volume,
 * regime4h (mirrors the Python breakdown dict's ema_cross/macd/rsi/bb/volume/
 * regime_4h keys, camelCased).
 */
export function signalScore(closes, { volumes = null, highs = null, lows = null, closes4h = null } = {}) {
  let score = 0.0;
  const parts = {};

  // 1. EMA Cross (20 vs 50 on execution timeframe)
  const cross = emaCrossState(closes, 20, 50);
  if (cross === null) {
    parts.emaCross = "n/a (need 51 bars)";
  } else if (cross === "golden") {
    score += 1;
    parts.emaCross = "GOLDEN (20>50, +1)";
  } else if (cross === "death") {
    score -= 1;
    parts.emaCross = "DEATH (20<50, -1)";
  } else {
    parts.emaCross = "neutral (0)";
  }

  // 2. MACD histogram green and rising
  const m = macd(closes);
  const flip = macdFlip(closes);
  const rising = macdHistRising(closes);
  if (m === null) {
    parts.macd = "n/a";
  } else {
    const hist = m[2];
    if (hist > 0 && rising) {
      score += 1;
      const label = flip === "bullish" ? "BULLISH FLIP " : "";
      parts.macd = `hist=${hist.toFixed(4)} ${label}green+rising (+1)`;
    } else if (hist < 0 && rising === false) {
      score -= 1;
      const label = flip === "bearish" ? "BEARISH FLIP " : "";
      parts.macd = `hist=${hist.toFixed(4)} ${label}red+falling (-1)`;
    } else if (hist > 0) {
      score += 0.5;
      parts.macd = `hist=${hist.toFixed(4)} green but not rising (+0.5)`;
    } else if (hist < 0) {
      score -= 0.5;
      parts.macd = `hist=${hist.toFixed(4)} red but not falling (-0.5)`;
    } else {
      parts.macd = `hist=${hist.toFixed(4)} (flat)`;
    }
  }

  // 3. RSI
  const r = rsi(closes);
  const rRise = rsiRising(closes);
  if (r === null) {
    parts.rsi = "n/a";
  } else if (r < 30) {
    score += 1;
    parts.rsi = `${r.toFixed(1)} oversold (<30, +1)`;
  } else if (r > 70) {
    score -= 1;
    parts.rsi = `${r.toFixed(1)} overbought (>70, -1)`;
  } else if (r >= 40 && r <= 65 && rRise) {
    score += 1;
    parts.rsi = `${r.toFixed(1)} in 40-65 and rising (+1)`;
  } else if (r < 40 && rRise === false) {
    score -= 0.5;
    parts.rsi = `${r.toFixed(1)} weak and falling (-0.5)`;
  } else {
    parts.rsi = `${r.toFixed(1)} neutral (0)`;
  }

  // 4. Bollinger Bands (%b position)
  const b = bollinger(closes);
  const bbTrend = bollingerTrend(closes);
  const bbSq = bollingerSqueeze(closes);
  if (b === null) {
    parts.bb = "n/a";
  } else {
    const pb = b[4];
    const sqTag = bbSq ? " SQUEEZE" : "";
    if (pb < 0.25) {
      score += 1;
      parts.bb = `%b=${pb.toFixed(2)} near lower band (+1) trend=${bbTrend}${sqTag}`;
    } else if (pb > 0.75) {
      score -= 1;
      parts.bb = `%b=${pb.toFixed(2)} near upper band (-1) trend=${bbTrend}${sqTag}`;
    } else {
      parts.bb = `%b=${pb.toFixed(2)} mid-band (0) trend=${bbTrend}${sqTag}`;
    }
  }

  // 5. Volume
  if (volumes !== null && volumes.length >= 21) {
    const vr = volumeRatio(volumes);
    if (vr === null) {
      parts.volume = "n/a";
    } else if (vr >= 1.2) {
      score += 1;
      parts.volume = `${vr.toFixed(2)}x avg (above avg, +1)`;
    } else if (vr < 0.7) {
      score -= 0.5;
      parts.volume = `${vr.toFixed(2)}x avg (thin, -0.5)`;
    } else {
      parts.volume = `${vr.toFixed(2)}x avg (0)`;
    }
  } else {
    parts.volume = "n/a (no volume data)";
  }

  // 6. 4H Higher-Timeframe Regime
  if (closes4h !== null && closes4h.length >= 51) {
    const cross4h = emaCrossState(closes4h, 20, 50);
    if (cross4h === "golden") {
      score += 1;
      parts.regime4h = "4H golden cross (uptrend, +1)";
    } else if (cross4h === "death") {
      score -= 1;
      parts.regime4h = "4H death cross (downtrend, -1)";
    } else {
      parts.regime4h = "4H neutral (0)";
    }
  } else {
    parts.regime4h = "n/a (no 4H data)";
  }

  return { score, parts };
}
