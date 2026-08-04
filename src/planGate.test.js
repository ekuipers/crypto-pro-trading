// src/planGate.test.js
//
// Pins the Pro entitlement decision (monetization phase 4). The Express
// middleware around it needs a live Postgres + session cookie, which no test in
// this project has a harness for — so the decision itself lives in the pure
// planGateStatus() precisely so it can be pinned here, the same split as
// credentialsRoutes.js's validators.
//
// This file is duplicated verbatim in Suite, Charts, Training and Trader
// because requirePlan() is a port, not a shared module. If you change one copy,
// change all four.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planGateStatus } from "./auth.js";

const free = { id: "u1", role: "free" };
const pro = { id: "u2", role: "pro" };
const admin = { id: "u3", role: "admin" };
const noRole = { id: "u4" };

describe("planGateStatus — signed out", () => {
  test("401, not 402: not signed in is a different fix than not subscribed", () => {
    assert.equal(planGateStatus(null, null), 401);
    assert.equal(planGateStatus(undefined, "pro"), 401);
  });
});

describe("planGateStatus — subscription path", () => {
  test("an active pro subscription allows", () => {
    assert.equal(planGateStatus(free, "pro"), null);
  });

  test("a free plan denies with 402", () => {
    assert.equal(planGateStatus(free, "free"), 402);
  });

  test("denies when getPlan could not be resolved", () => {
    assert.equal(planGateStatus(free, null), 402);
  });

  test("an account with no role column still works off the subscription", () => {
    assert.equal(planGateStatus(noRole, "pro"), null);
    assert.equal(planGateStatus(noRole, "free"), 402);
  });
});

describe("planGateStatus — role path", () => {
  test("admin allows even with no subscription, or support cannot see the feature", () => {
    assert.equal(planGateStatus(admin, "free"), null);
    assert.equal(planGateStatus(admin, null), null);
  });

  test("a manually granted pro role allows without a subscription row", () => {
    assert.equal(planGateStatus(pro, "free"), null);
    assert.equal(planGateStatus(pro, null), null);
  });

  test("role is matched against the wanted plan, not hardcoded to 'pro'", () => {
    // Guards against a future requirePlan('enterprise') silently passing
    // everyone whose role happens to be 'pro'.
    assert.equal(planGateStatus(pro, null, "enterprise"), 402);
    assert.equal(planGateStatus(admin, null, "enterprise"), null);
  });
});

describe("planGateStatus — defaults", () => {
  test("wanted defaults to 'pro'", () => {
    assert.equal(planGateStatus(free, "pro"), planGateStatus(free, "pro", "pro"));
    assert.equal(planGateStatus(free, "free"), 402);
  });
});
