// src/tz.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { amsterdamParts } from "./tz.js";

describe("amsterdamParts", () => {
  test("winter offset is UTC+1 (CET)", () => {
    const p = amsterdamParts(new Date("2026-01-15T10:05:00Z"));
    assert.equal(p.dateStr, "2026-01-15");
    assert.equal(p.timeStr, "11:05");
  });

  test("summer offset is UTC+2 (CEST)", () => {
    const p = amsterdamParts(new Date("2026-07-19T10:05:00Z"));
    assert.equal(p.dateStr, "2026-07-19");
    assert.equal(p.timeStr, "12:05");
  });

  test("spring-forward transition 2026-03-29: CET before, CEST after", () => {
    const before = amsterdamParts(new Date("2026-03-29T00:30:00Z"));
    assert.equal(before.dateStr, "2026-03-29");
    assert.equal(before.timeStr, "01:30"); // still CET (+1)

    const after = amsterdamParts(new Date("2026-03-29T01:30:00Z"));
    assert.equal(after.timeStr, "03:30"); // now CEST (+2); 02:00-03:00 local is skipped
  });

  test("fall-back transition 2026-10-25: CEST before, CET after", () => {
    const before = amsterdamParts(new Date("2026-10-25T00:30:00Z"));
    assert.equal(before.timeStr, "02:30"); // still CEST (+2)

    const after = amsterdamParts(new Date("2026-10-25T02:30:00Z"));
    assert.equal(after.timeStr, "03:30"); // now CET (+1)
  });

  test("date rolls over at Amsterdam local midnight, not UTC midnight", () => {
    // 23:30 UTC on Jan 15 is already 00:30 the next day in Amsterdam (CET, +1).
    const p = amsterdamParts(new Date("2026-01-15T23:30:00Z"));
    assert.equal(p.dateStr, "2026-01-16");
    assert.equal(p.timeStr, "00:30");
  });
});
