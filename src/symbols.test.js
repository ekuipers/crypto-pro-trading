// src/symbols.test.js
//
// Port of tests/test_symbols.py.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toSlash } from "./symbols.js";

describe("toSlash", () => {
  const cases = [
    ["BTCUSD", "BTC/USD"], // bare Alpaca form -> canonical
    ["ETHUSD", "ETH/USD"],
    ["BTCUSDT", "BTC/USDT"], // longest quote wins over USD
    ["ETHUSDC", "ETH/USDC"],
    ["USDTUSD", "USDT/USD"], // stablecoin base against USD
    ["BTC/USD", "BTC/USD"], // already canonical: unchanged
    ["BTC/USDT", "BTC/USDT"],
    ["SOLBTC", "SOLBTC"], // unknown quote: unchanged
    ["USD", "USD"], // quote alone: no empty base
    ["", ""], // empty input: unchanged
  ];
  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(toSlash(raw), expected);
    });
  }
});
