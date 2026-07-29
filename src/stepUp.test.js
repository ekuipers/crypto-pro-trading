// src/stepUp.test.js
//
// Phase 6 step-up authentication: the policy predicate (which credential
// mutations demand the account password) and the verifier itself.
//
// Both are tested for what they REFUSE. A step-up check is only worth having
// if it fails closed, so most of these assert that some plausible-looking
// input does NOT come back true.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { stepUpRequired } from "./credentialsRoutes.js";
import { verifyStepUpPassword } from "./auth.js";
import { GUEST } from "./db.js";

// Mirrors auth.js's own scheme (salted scrypt, 64 bytes, hex) so a fixture
// account is indistinguishable from a real row to the code under test.
const PASSWORD = "correct horse battery staple";
const SALT = "0123456789abcdef0123456789abcdef";
const account = (over = {}) => ({
  id: "alice",
  salt: SALT,
  passwordHash: crypto.scryptSync(PASSWORD, SALT, 64).toString("hex"),
  ...over,
});
const getAccount = (row) => async () => row;

describe("stepUpRequired — destructive actions only", () => {
  test("deleting a credential always demands the password", () => {
    assert.equal(stepUpRequired("delete"), true);
    assert.equal(stepUpRequired("delete", { isActive: false }), true,
      "an inactive row is still unrecoverable once deleted");
  });

  test("replacing the ACTIVE credential demands the password", () => {
    assert.equal(stepUpRequired("replace", { isActive: true }), true);
  });

  test("replacing a stored-but-inactive credential does not", () => {
    assert.equal(stepUpRequired("replace", { isActive: false }), false);
  });

  test("connecting a first credential stays frictionless", () => {
    // Deliberate: a password wall here protects nothing (a session holder
    // could connect their own key regardless) and blocks every new user.
    assert.equal(stepUpRequired("connect"), false);
    assert.equal(stepUpRequired("connect", { isActive: true }), false);
  });

  test("activating an already-stored credential does not", () => {
    assert.equal(stepUpRequired("activate", { isActive: true }), false);
  });

  test("an unrecognised action does not silently become privileged", () => {
    // Fails to "no step-up" rather than "step-up" on purpose: an unknown
    // action reaching here is a bug, and the routes gate each action
    // explicitly. What must never happen is a typo'd action name being
    // treated as authenticated — that is covered by the routes, which only
    // ever pass these four literals.
    assert.equal(stepUpRequired("rotate"), false);
    assert.equal(stepUpRequired(undefined), false);
  });
});

describe("verifyStepUpPassword — fails closed", () => {
  test("accepts the correct password", async () => {
    assert.equal(await verifyStepUpPassword("alice", PASSWORD, { getAccount: getAccount(account()) }), true);
  });

  test("rejects a wrong password", async () => {
    assert.equal(await verifyStepUpPassword("alice", "wrong", { getAccount: getAccount(account()) }), false);
  });

  test("rejects an empty, missing, or non-string password", async () => {
    const deps = { getAccount: getAccount(account()) };
    for (const pw of ["", null, undefined, 0, false]) {
      assert.equal(await verifyStepUpPassword("alice", pw, deps), false, `${JSON.stringify(pw)} must not pass`);
    }
  });

  test("rejects a guest and a missing uid without consulting the database", async () => {
    let looked = false;
    const deps = { getAccount: async () => { looked = true; return account(); } };
    for (const uid of [GUEST, "", null, undefined]) {
      assert.equal(await verifyStepUpPassword(uid, PASSWORD, deps), false, `${JSON.stringify(uid)} must not pass`);
    }
    assert.equal(looked, false, "a guest must never reach an account lookup");
  });

  test("rejects when the account no longer exists", async () => {
    assert.equal(await verifyStepUpPassword("ghost", PASSWORD, { getAccount: async () => null }), false);
  });

  test("rejects an account row with no stored hash rather than treating it as a match", async () => {
    for (const broken of [{ salt: SALT, passwordHash: null }, { salt: null, passwordHash: "ab" }, {}]) {
      const deps = { getAccount: getAccount({ id: "alice", ...broken }) };
      assert.equal(await verifyStepUpPassword("alice", PASSWORD, deps), false);
    }
  });

  test("a database failure denies instead of erroring open or throwing", async () => {
    const deps = { getAccount: async () => { throw new Error("connection lost"); } };
    assert.equal(await verifyStepUpPassword("alice", PASSWORD, deps), false);
  });

  test("a malformed stored hash denies instead of throwing", async () => {
    // timingSafeEqual throws on a length mismatch; a corrupt row must not
    // become a 500 on a security check.
    const deps = { getAccount: getAccount(account({ passwordHash: "not-hex" })) };
    assert.equal(await verifyStepUpPassword("alice", PASSWORD, deps), false);
  });
});
