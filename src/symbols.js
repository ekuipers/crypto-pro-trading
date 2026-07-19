// src/symbols.js
//
// Canonical symbol-notation helper — a faithful port of scripts/symbols.py.
//
// Design rule: the canonical symbol notation everywhere in this project --
// config.json, journals, console logs, state files, and the dashboard -- is
// the slash pair form `BASE/QUOTE` (e.g. `BTC/USD`). Alpaca returns crypto
// symbols WITHOUT the slash (`BTCUSD`) in the positions / orders /
// activities responses, so conversion to canonical form happens at that API
// boundary and nowhere else.
//
// Mirrors the dashboard's toSlash() helper in docs/dashboard_professional.html
// (same quote list, longest match first) -- keep the two in sync.

// Longest first so BTCUSDT -> BTC/USDT, not BTCUS/DT or BTCU/SDT.
const QUOTES = ["USDT", "USDC", "USD"];

/**
 * Normalise an Alpaca crypto symbol to canonical `BASE/QUOTE` form.
 *
 * `"BTCUSD" -> "BTC/USD"`, `"BTCUSDT" -> "BTC/USDT"`. Already-slashed symbols
 * and symbols with an unrecognised quote are returned unchanged.
 */
export function toSlash(sym) {
  if (!sym || sym.includes("/")) return sym;
  for (const quote of QUOTES) {
    if (sym.endsWith(quote) && sym.length > quote.length) {
      return sym.slice(0, -quote.length) + "/" + quote;
    }
  }
  return sym;
}
