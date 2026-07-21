// src/cronSchedule.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isJobDue, todayUtcDateStr } from "./cronSchedule.js";

describe("todayUtcDateStr", () => {
  test("formats the UTC date, not local", () => {
    assert.equal(todayUtcDateStr(new Date("2026-07-21T23:59:00Z")), "2026-07-21");
    assert.equal(todayUtcDateStr(new Date("2026-07-22T00:00:00Z")), "2026-07-22");
  });
});

describe("isJobDue", () => {
  test("false when hourUtc is unset", () => {
    assert.equal(isJobDue(null, new Date("2026-07-21T02:00:00Z"), null), false);
    assert.equal(isJobDue(undefined, new Date("2026-07-21T02:00:00Z"), null), false);
  });

  test("false when the current UTC hour doesn't match", () => {
    assert.equal(isJobDue(2, new Date("2026-07-21T03:05:00Z"), null), false);
  });

  test("true on the configured hour when it has never run", () => {
    assert.equal(isJobDue(2, new Date("2026-07-21T02:05:00Z"), null), true);
  });

  test("false when it already ran earlier the same UTC day", () => {
    assert.equal(isJobDue(2, new Date("2026-07-21T02:45:00Z"), "2026-07-21T02:05:00Z"), false);
  });

  test("true again once the UTC day has rolled over", () => {
    assert.equal(isJobDue(2, new Date("2026-07-22T02:05:00Z"), "2026-07-21T02:05:00Z"), true);
  });

  test("a malformed lastRunAt is treated as never-run (fail open, not stuck)", () => {
    assert.equal(isJobDue(2, new Date("2026-07-21T02:05:00Z"), "not-a-date"), true);
  });
});
