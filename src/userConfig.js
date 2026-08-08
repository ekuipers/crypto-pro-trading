// src/userConfig.js
//
// Per-user strategy config (see CLAUDE.md "Multi-tenant engine — standing rules"):
// per-user strategy/risk configuration.
//
// The engine's tunables used to exist only as module-level constants in
// risk.js and strategyConfig.js, read from config.json at import time. That
// is fine for one account but makes per-user strategy impossible in a single
// process -- the same problem Phase 1 solved for credentials.
//
// This module is the *resolution* layer, not a second source of truth:
//
//   DEFAULT_CFG            one flat frozen object assembled from the existing
//                          risk.js/strategyConfig.js constants. Same
//                          UPPER_SNAKE key names on purpose, so converting a
//                          consumer is a mechanical `X` -> `cfg.X` rename and
//                          stays greppable against the old code.
//   CONFIG_SPEC            per-key type/bounds/locked metadata. The bounds are
//                          not cosmetic: they are where CLAUDE.md's "Hard
//                          rules -- never break" are enforced against
//                          user-supplied JSON (see the `hardRule` notes).
//   validateOverrides()    pure validator -> { ok, errors, clean }
//   mergeConfig()          DEFAULT_CFG + validated overrides -> frozen cfg
//   resolveConfigForUser() the above, backed by trader_strategy_config
//
// Nothing here mutates the imported constants, so the legacy/CLI path (no
// uid) keeps resolving to exactly today's compiled values -- zero behavior
// change for anyone not opted in.

import * as risk from "./risk.js";
import * as strat from "./strategyConfig.js";

// ---------------------------------------------------------------------------
// Default layer -- the compiled-in config.json values, flattened
// ---------------------------------------------------------------------------

const _caps = strat.CFG.portfolio_caps || {};

export const DEFAULT_CFG = Object.freeze({
  // --- scoring gates (strategyConfig.js) ---
  BUY_SCORE_THRESHOLD: strat.BUY_SCORE_THRESHOLD,
  BUY_SCORE_HALF_SIZE: strat.BUY_SCORE_HALF_SIZE,
  SELL_SCORE_THRESHOLD: strat.SELL_SCORE_THRESHOLD,
  SHORT_SCORE_THRESHOLD: strat.SHORT_SCORE_THRESHOLD,
  SHORT_SCORE_HALF_SIZE: strat.SHORT_SCORE_HALF_SIZE,
  COVER_SCORE_THRESHOLD: strat.COVER_SCORE_THRESHOLD,
  DOWNTREND_LONG_SCORE: strat.DOWNTREND_LONG_SCORE,

  // --- sizing ---
  ATR_MULTIPLIER: strat.ATR_MULTIPLIER,
  RISK_PER_TRADE_PCT: strat.RISK_PER_TRADE_PCT,
  FALLBACK_SIZE_PCT: strat.FALLBACK_SIZE_PCT,
  MAX_POSITION_PCT: risk.MAX_POSITION_PCT,
  PORTFOLIO_CAPS: Object.freeze({
    caps: Object.freeze({ ..._caps.caps }),
    default_cap: Number(_caps.default_cap ?? 0.05),
  }),

  // --- execution bands ---
  LIMIT_BAND_PCT: risk.LIMIT_BAND_PCT,
  STOP_LOSS_LIMIT_BAND_PCT: risk.STOP_LOSS_LIMIT_BAND_PCT,
  STOP_LOSS_ESCALATION_CYCLES: risk.STOP_LOSS_ESCALATION_CYCLES,
  STOP_LOSS_ESCALATION_EXTRA_PCT: risk.STOP_LOSS_ESCALATION_EXTRA_PCT,

  // --- stops ---
  STOP_LOSS_MODE: risk.STOP_LOSS_MODE,
  STOP_LOSS_PCT: risk.STOP_LOSS_PCT,
  SWING_LOW_LOOKBACK_BARS: risk.SWING_LOW_LOOKBACK_BARS,
  SWING_LOW_BUFFER_PCT: risk.SWING_LOW_BUFFER_PCT,
  SWING_LOW_MAX_STOP_PCT: risk.SWING_LOW_MAX_STOP_PCT,
  TRAILING_STOP_ACTIVATION_PCT: risk.TRAILING_STOP_ACTIVATION_PCT,
  TRAILING_STOP_TRAIL_PCT: risk.TRAILING_STOP_TRAIL_PCT,
  CAPITAL_PRESERVATION_STOP_PCT: risk.CAPITAL_PRESERVATION_STOP_PCT,
  TRAIL_MODE: risk.TRAIL_MODE,
  CHANDELIER_ATR_MULT: risk.CHANDELIER_ATR_MULT,

  // --- correlation budget ---
  MAX_OPEN_POSITIONS: risk.MAX_OPEN_POSITIONS,
  MAX_POSITIONS_PER_TIER: risk.MAX_POSITIONS_PER_TIER,
  TIER1_SYMBOLS: Object.freeze([...risk.TIER1_SYMBOLS]),
  ENFORCE_BUDGET_ON_OPEN_POSITIONS: risk.ENFORCE_BUDGET_ON_OPEN_POSITIONS,

  // --- exits ---
  MAX_HOLD_HOURS: risk.MAX_HOLD_HOURS,
  PARTIAL_TP_ENABLED: risk.PARTIAL_TP_ENABLED,
  PARTIAL_TP_R_MULTIPLE: risk.PARTIAL_TP_R_MULTIPLE,
  PARTIAL_TP_FRACTION: risk.PARTIAL_TP_FRACTION,

  // --- trade economics ---
  TAKER_FEE_BPS_PER_SIDE: risk.TAKER_FEE_BPS_PER_SIDE,
  MIN_RR_FULL: risk.MIN_RR_FULL,
  MIN_RR_HALF: risk.MIN_RR_HALF,

  // --- rotation ---
  ROTATION_ENABLED: risk.ROTATION_ENABLED,
  ROTATION_MIN_SCORE: risk.ROTATION_MIN_SCORE,
  ROTATION_SCORE_MARGIN: risk.ROTATION_SCORE_MARGIN,

  // --- daily gate / streak throttle ---
  DAILY_DRAWDOWN_GATE_PCT: risk.DAILY_DRAWDOWN_GATE_PCT,
  STREAK_THROTTLE_ENABLED: risk.STREAK_THROTTLE_ENABLED,
  STREAK_THROTTLE_LOSSES: risk.STREAK_THROTTLE_LOSSES,
  STREAK_THROTTLE_DD_PCT: risk.STREAK_THROTTLE_DD_PCT,
  STREAK_THROTTLE_RECOVER_DD_PCT: risk.STREAK_THROTTLE_RECOVER_DD_PCT,
  STREAK_THROTTLE_WINNERS: risk.STREAK_THROTTLE_WINNERS,
  STREAK_THROTTLE_RISK_FACTOR: risk.STREAK_THROTTLE_RISK_FACTOR,

  // --- session-edge filter ---
  SESSION_FILTER_ENABLED: strat.SESSION_FILTER_ENABLED,
  SESSION_MIN_SAMPLE: strat.SESSION_MIN_SAMPLE,

  // --- locked: shorts + ships-OFF "famous-trader package" extras ---
  SHORTS_ENABLED: strat.SHORTS_ENABLED,
  MAKER_FIRST_ENTRIES: strat.MAKER_FIRST_ENTRIES,
  PYRAMID_ENABLED: strat.PYRAMID_ENABLED,
  PYRAMID_MAX_TRANCHES: strat.PYRAMID_MAX_TRANCHES,
  PYRAMID_ADX_MIN: strat.PYRAMID_ADX_MIN,
  CONVICTION_SIZING_ENABLED: strat.CONVICTION_SIZING_ENABLED,
  CONVICTION_HIGH_SCORE: strat.CONVICTION_HIGH_SCORE,
  MEASURED_MOVE_ENABLED: strat.MEASURED_MOVE_ENABLED,
  MEASURED_MOVE_ADX_MIN: strat.MEASURED_MOVE_ADX_MIN,
  BREADTH_GATE_ENABLED: strat.BREADTH_GATE_ENABLED,
  BREADTH_LOW_PCT: strat.BREADTH_LOW_PCT,
});

// ---------------------------------------------------------------------------
// Watchlist -- the canonical default symbol list and the Free-plan cap on it.
//
// Mirrored in the browser at src/js/analytics-watchlist.js's DEFAULT_WATCHLIST
// (same convention as MIN_TRADED_BARS's three-way mirror note in CLAUDE.md) --
// that copy exists because the dashboard needs it with no server round-trip.
// This is the Node-side canonical copy: the seed for a tenant who has never
// customized their Settings-page watchlist, and the fallback for the
// legacy/CLI single-tenant path and the offline measurement scripts.
// ---------------------------------------------------------------------------
export const DEFAULT_WATCHLIST = Object.freeze([
  "BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "LINK/USD",
  "DOT/USD", "LTC/USD", "DOGE/USD", "ADA/USD", "AAVE/USD",
]);

// Free plan: how many symbols of a tenant's own watchlist the engine will
// scan. Pro is uncapped (up to the dashboard's own WL_MAX). Enforced in three
// places -- see CLAUDE.md's "Plan entitlements": client (analytics-watchlist.js,
// primary), PUT /api/session (defense in depth), buildTenantContext() (covers
// a stale row from before a Pro->Free downgrade).
export const FREE_WATCHLIST_LIMIT = 3;

// ---------------------------------------------------------------------------
// Spec -- types, bounds, and which keys a user may set at all
// ---------------------------------------------------------------------------

// `hardRule` marks a bound that exists because CLAUDE.md's "Hard rules --
// never break" section says so, not because it seemed like a sensible range.
// Loosening one of these is a trading-rule change, not a config tweak.
const N = (min, max, hardRule) => ({ type: "number", min, max, hardRule });
const B = () => ({ type: "boolean" });
const LOCKED = (why) => ({ locked: why });

export const CONFIG_SPEC = Object.freeze({
  BUY_SCORE_THRESHOLD: N(0, 6),
  BUY_SCORE_HALF_SIZE: N(0, 6),
  SELL_SCORE_THRESHOLD: N(-6, 0),
  SHORT_SCORE_THRESHOLD: N(-6, 0),
  SHORT_SCORE_HALF_SIZE: N(-6, 0),
  COVER_SCORE_THRESHOLD: N(0, 6),
  DOWNTREND_LONG_SCORE: N(0, 6),

  ATR_MULTIPLIER: N(0.5, 5),
  // "ATR sizing: risk = equity x 1%". 2% is the ceiling a user may dial to.
  RISK_PER_TRADE_PCT: N(0.001, 0.02, "risk per trade is equity x 1%"),
  FALLBACK_SIZE_PCT: N(0.001, 0.05),
  // Largest per-symbol cap in the table is BTC at 30%; nothing may exceed it.
  MAX_POSITION_PCT: N(0.01, 0.3, "per-symbol caps, max 30% (BTC)"),
  PORTFOLIO_CAPS: { type: "caps", max: 0.3, hardRule: "per-symbol caps, max 30% (BTC)" },

  // "Limit orders only (<=0.2% from ask; 0.5% for stops)".
  LIMIT_BAND_PCT: N(0.0001, 0.002, "limit orders within 0.2% of ask"),
  STOP_LOSS_LIMIT_BAND_PCT: N(0.0005, 0.005, "stop limit band 0.5%"),
  STOP_LOSS_ESCALATION_CYCLES: N(1, 10),
  // Tightened 0.01 -> 0.005 on 2026-07-29, when the escalation stopped being a
  // no-op. Until then alpacaClient clamped every stop back to the base band, so
  // this value could not reach an order and its bound never mattered. Now it
  // does: base (max 0.005) + extra caps a stop-loss limit at 1.0% from the ask,
  // which is the real hard ceiling. Default stays 0.003, i.e. 0.8%.
  STOP_LOSS_ESCALATION_EXTRA_PCT: N(0, 0.005, "escalated stop band max 1.0% total"),

  STOP_LOSS_MODE: { type: "enum", values: ["swing_low_4h", "fixed"] },
  STOP_LOSS_PCT: N(0.01, 0.1),
  SWING_LOW_LOOKBACK_BARS: N(5, 100),
  SWING_LOW_BUFFER_PCT: N(0, 0.01),
  // "Long stop = previous 4H swing low (20 bars, <=8% below entry)".
  SWING_LOW_MAX_STOP_PCT: N(0.01, 0.08, "swing-low stop at most 8% below entry"),
  TRAILING_STOP_ACTIVATION_PCT: N(0.005, 0.2),
  TRAILING_STOP_TRAIL_PCT: N(0.005, 0.2),
  CAPITAL_PRESERVATION_STOP_PCT: N(0.005, 0.1),
  TRAIL_MODE: LOCKED("chandelier trailing is not ported to risk.js"),
  CHANDELIER_ATR_MULT: LOCKED("chandelier trailing is not ported to risk.js"),

  // "Correlation budget: 7 total / 5 per tier".
  MAX_OPEN_POSITIONS: N(1, 7, "correlation budget: 7 total"),
  MAX_POSITIONS_PER_TIER: N(1, 5, "correlation budget: 5 per tier"),
  TIER1_SYMBOLS: { type: "symbols" },
  ENFORCE_BUDGET_ON_OPEN_POSITIONS: B(),

  MAX_HOLD_HOURS: N(0, 720),
  PARTIAL_TP_ENABLED: B(),
  PARTIAL_TP_R_MULTIPLE: N(0.25, 5),
  PARTIAL_TP_FRACTION: N(0.05, 0.95),

  TAKER_FEE_BPS_PER_SIDE: N(0, 100),
  MIN_RR_FULL: N(0, 10),
  MIN_RR_HALF: N(0, 10),

  ROTATION_ENABLED: B(),
  ROTATION_MIN_SCORE: N(0, 6),
  ROTATION_SCORE_MARGIN: N(0, 6),

  DAILY_DRAWDOWN_GATE_PCT: N(0.005, 0.2),
  // "Streak throttle (ACTIVE)" -- a user may retune it but not switch it off.
  STREAK_THROTTLE_ENABLED: LOCKED("the streak throttle is an always-on risk control"),
  STREAK_THROTTLE_LOSSES: N(1, 20),
  STREAK_THROTTLE_DD_PCT: N(0.01, 0.5),
  STREAK_THROTTLE_RECOVER_DD_PCT: N(0, 0.5),
  STREAK_THROTTLE_WINNERS: N(1, 20),
  STREAK_THROTTLE_RISK_FACTOR: N(0.1, 1),

  SESSION_FILTER_ENABLED: B(),
  SESSION_MIN_SAMPLE: N(5, 500),

  // Shorts are off because Alpaca crypto is spot-only -- this is not a
  // preference. The rest gate Python functions that were never ported to
  // risk.js; assertNotShipped() throws if one is on, so letting a user set
  // one would just break their own engine at import time.
  SHORTS_ENABLED: LOCKED("Alpaca crypto is spot-only; shorts are disabled"),
  MAKER_FIRST_ENTRIES: LOCKED("maker-first entries are not ported"),
  PYRAMID_ENABLED: LOCKED("pyramiding is not ported"),
  PYRAMID_MAX_TRANCHES: LOCKED("pyramiding is not ported"),
  PYRAMID_ADX_MIN: LOCKED("pyramiding is not ported"),
  CONVICTION_SIZING_ENABLED: LOCKED("conviction sizing is not ported"),
  CONVICTION_HIGH_SCORE: LOCKED("conviction sizing is not ported"),
  MEASURED_MOVE_ENABLED: LOCKED("measured-move targets are not ported"),
  MEASURED_MOVE_ADX_MIN: LOCKED("measured-move targets are not ported"),
  BREADTH_GATE_ENABLED: LOCKED("the breadth gate is not ported"),
  BREADTH_LOW_PCT: LOCKED("the breadth gate is not ported"),
});

/** Keys a signed-in user may actually override, for the Phase 6 editor. */
export const EDITABLE_KEYS = Object.freeze(
  Object.keys(CONFIG_SPEC).filter((k) => !CONFIG_SPEC[k].locked).sort()
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateNumber(key, value, spec, errors) {
  // Strict: no coercion. A quoted "4.0" from the JSON editor is a mistake
  // worth surfacing, not something to silently accept -- and `true` would
  // otherwise coerce to 1 and land inside several of these ranges.
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${key}: expected a number, got ${JSON.stringify(value)}`);
    return undefined;
  }
  const n = value;
  if (n < spec.min || n > spec.max) {
    const why = spec.hardRule ? ` (hard rule: ${spec.hardRule})` : "";
    errors.push(`${key}: ${n} is outside the allowed range ${spec.min}..${spec.max}${why}`);
    return undefined;
  }
  return n;
}

function validateCaps(key, value, spec, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${key}: expected an object like { caps: {...}, default_cap: 0.05 }`);
    return undefined;
  }
  const caps = value.caps;
  if (caps !== undefined && (!caps || typeof caps !== "object" || Array.isArray(caps))) {
    errors.push(`${key}.caps: expected an object of symbol -> fraction`);
    return undefined;
  }
  const out = { caps: {}, default_cap: DEFAULT_CFG.PORTFOLIO_CAPS.default_cap };
  for (const [sym, raw] of Object.entries(caps || {})) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > spec.max) {
      errors.push(`${key}.caps.${sym}: ${JSON.stringify(raw)} must be a number > 0 and <= ${spec.max} (hard rule: ${spec.hardRule})`);
      continue;
    }
    out.caps[sym] = raw;
  }
  if (value.default_cap !== undefined) {
    const d = value.default_cap;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0 || d > spec.max) {
      errors.push(`${key}.default_cap: ${JSON.stringify(value.default_cap)} must be > 0 and <= ${spec.max} (hard rule: ${spec.hardRule})`);
    } else {
      out.default_cap = d;
    }
  }
  return out;
}

function validateSymbols(key, value, errors) {
  if (!Array.isArray(value) || value.some((s) => typeof s !== "string" || !s.trim())) {
    errors.push(`${key}: expected an array of symbol strings like ["BTC/USD"]`);
    return undefined;
  }
  return value.map((s) => s.trim().toUpperCase());
}

/**
 * Validate a raw per-user override object against CONFIG_SPEC.
 *
 * Unknown keys are an error rather than being silently dropped: a typo in the
 * Phase 6 JSON editor would otherwise look like it saved fine while the
 * engine kept trading the default value.
 *
 * Returns { ok, errors, clean } -- `clean` holds only the keys that passed, so
 * a caller that ignores `ok` still never applies a rejected value.
 */
export function validateOverrides(raw) {
  const errors = [];
  const clean = {};
  if (raw === null || raw === undefined) return { ok: true, errors, clean };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["config must be a JSON object"], clean };
  }

  for (const [key, value] of Object.entries(raw)) {
    // Object.hasOwn, not `CONFIG_SPEC[key]`: `__proto__`/`constructor`/
    // `toString` all resolve to truthy inherited members, which would slip
    // past an unknown-key check and land in a branch that reads `spec.type`
    // off Object.prototype.
    const spec = Object.hasOwn(CONFIG_SPEC, key) ? CONFIG_SPEC[key] : null;
    if (!spec) {
      errors.push(`${key}: unknown setting`);
      continue;
    }
    if (spec.locked) {
      errors.push(`${key}: not user-configurable (${spec.locked})`);
      continue;
    }
    if (value === undefined) continue;

    let out;
    if (spec.type === "number") out = validateNumber(key, value, spec, errors);
    else if (spec.type === "boolean") {
      if (typeof value !== "boolean") errors.push(`${key}: expected true or false, got ${JSON.stringify(value)}`);
      else out = value;
    } else if (spec.type === "enum") {
      if (!spec.values.includes(value)) errors.push(`${key}: expected one of ${spec.values.join(", ")}`);
      else out = value;
    } else if (spec.type === "caps") out = validateCaps(key, value, spec, errors);
    else if (spec.type === "symbols") out = validateSymbols(key, value, errors);

    if (out !== undefined) clean[key] = out;
  }

  // Cross-field checks -- individually valid values that contradict each
  // other. A failing pair is DROPPED from `clean`, not merely reported:
  // mergeConfig applies `clean` regardless of `ok` (so one bad key can't
  // stop a whole engine), which would otherwise let a contradiction the
  // validator just rejected still reach a trading decision.
  const CROSS_CHECKS = [
    {
      keys: ["BUY_SCORE_HALF_SIZE", "BUY_SCORE_THRESHOLD"],
      bad: (c) => c.BUY_SCORE_HALF_SIZE > c.BUY_SCORE_THRESHOLD,
      msg: "BUY_SCORE_HALF_SIZE must not exceed BUY_SCORE_THRESHOLD (the half-size gate is the looser one)",
    },
    {
      keys: ["MAX_POSITIONS_PER_TIER", "MAX_OPEN_POSITIONS"],
      bad: (c) => c.MAX_POSITIONS_PER_TIER > c.MAX_OPEN_POSITIONS,
      msg: "MAX_POSITIONS_PER_TIER must not exceed MAX_OPEN_POSITIONS",
    },
    {
      keys: ["STREAK_THROTTLE_RECOVER_DD_PCT", "STREAK_THROTTLE_DD_PCT"],
      bad: (c) => c.STREAK_THROTTLE_RECOVER_DD_PCT >= c.STREAK_THROTTLE_DD_PCT,
      msg: "STREAK_THROTTLE_RECOVER_DD_PCT must be below STREAK_THROTTLE_DD_PCT (otherwise the throttle can never release)",
    },
    {
      keys: ["TRAILING_STOP_TRAIL_PCT", "STOP_LOSS_PCT"],
      bad: (c) => c.TRAILING_STOP_TRAIL_PCT > c.STOP_LOSS_PCT,
      msg: "TRAILING_STOP_TRAIL_PCT must not exceed STOP_LOSS_PCT (a trail wider than the hard stop never fires)",
    },
  ];
  for (const check of CROSS_CHECKS) {
    if (check.bad({ ...DEFAULT_CFG, ...clean })) {
      errors.push(check.msg);
      for (const k of check.keys) delete clean[k];
    }
  }

  return { ok: errors.length === 0, errors, clean };
}

/**
 * DEFAULT_CFG with validated overrides applied. Invalid keys are dropped, so
 * a stored row that predates a tightened bound degrades to the default for
 * that one key instead of failing the whole resolve and stopping the engine.
 */
export function mergeConfig(overrides) {
  const { clean, errors } = validateOverrides(overrides);
  const cfg = { ...DEFAULT_CFG, ...clean };
  if (clean.PORTFOLIO_CAPS) {
    cfg.PORTFOLIO_CAPS = Object.freeze({
      caps: Object.freeze({ ...DEFAULT_CFG.PORTFOLIO_CAPS.caps, ...clean.PORTFOLIO_CAPS.caps }),
      default_cap: clean.PORTFOLIO_CAPS.default_cap,
    });
  }
  if (clean.TIER1_SYMBOLS) cfg.TIER1_SYMBOLS = Object.freeze(clean.TIER1_SYMBOLS);
  return { cfg: Object.freeze(cfg), errors };
}

/** Per-symbol cap fraction under a resolved cfg (BTC 30%, default 5%). */
export function cfgSymbolCap(cfg, symbol) {
  const pc = (cfg || DEFAULT_CFG).PORTFOLIO_CAPS || DEFAULT_CFG.PORTFOLIO_CAPS;
  // hasOwn, not `?.[symbol]`: a symbol named "__proto__" would otherwise
  // resolve to Object.prototype and be used as a position-cap fraction.
  const caps = pc.caps || {};
  if (Object.hasOwn(caps, symbol) && typeof caps[symbol] === "number") return caps[symbol];
  return pc.default_cap ?? 0.05;
}

// ---------------------------------------------------------------------------
// Per-user resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective config for `uid`: the stored trader_strategy_config
 * row merged over DEFAULT_CFG. A falsy uid, a missing row, or an unreachable
 * database all resolve to DEFAULT_CFG -- the legacy/CLI path keeps behaving
 * exactly as it does today.
 *
 * Never throws: a config lookup failing must not take down a trading cycle
 * that would otherwise run correctly on defaults. `errors` carries anything
 * the caller should log.
 *
 * db.js is imported lazily so this module stays importable (and unit-testable)
 * without a database or `pg` connection -- same reasoning as secretsCrypto.js
 * reading its key inside each call rather than at module scope.
 */
export async function resolveConfigForUser(uid, deps = {}) {
  if (!uid) return { cfg: DEFAULT_CFG, errors: [], source: "default" };

  let getStrategyConfig = deps.getStrategyConfig;
  if (!getStrategyConfig) {
    try {
      ({ getStrategyConfig } = await import("./db.js"));
    } catch (e) {
      return { cfg: DEFAULT_CFG, errors: [`config store unavailable: ${e.message}`], source: "default" };
    }
  }

  let row;
  try {
    row = await getStrategyConfig(uid);
  } catch (e) {
    return { cfg: DEFAULT_CFG, errors: [`config lookup failed for ${uid}: ${e.message}`], source: "default" };
  }
  if (!row) return { cfg: DEFAULT_CFG, errors: [], source: "default" };

  const { cfg, errors } = mergeConfig(row);
  return { cfg, errors, source: "user" };
}
