// src/env.test.js
//
// Net-new tests (no matching tests/test_env.py exists in the Python suite)
// for the loadEnv() port of scripts/_env.py. Uses an injected target object
// and a temp file so tests never touch the real process.env or repo .env.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEnv } from "./env.js";

function withEnvFile(contents, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cryptopro-env-test-"));
  const file = path.join(dir, ".env");
  writeFileSync(file, contents, "utf-8");
  try {
    fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadEnv", () => {
  test("missing file is a silent no-op", () => {
    const target = {};
    const n = loadEnv("/definitely/not/a/real/path/.env", target);
    assert.equal(n, 0);
    assert.deepEqual(target, {});
  });

  test("parses basic KEY=VALUE pairs", () => {
    withEnvFile("APCA_API_KEY_ID=abc123\nAPCA_API_SECRET_KEY=shh\n", (file) => {
      const target = {};
      const n = loadEnv(file, target);
      assert.equal(n, 2);
      assert.equal(target.APCA_API_KEY_ID, "abc123");
      assert.equal(target.APCA_API_SECRET_KEY, "shh");
    });
  });

  test("existing keys always win over the .env value", () => {
    withEnvFile("APCA_API_KEY_ID=fromfile\n", (file) => {
      const target = { APCA_API_KEY_ID: "fromenv" };
      loadEnv(file, target);
      assert.equal(target.APCA_API_KEY_ID, "fromenv");
    });
  });

  test("skips blank lines and comments", () => {
    withEnvFile("\n# a comment\n\nKEY=value\n  # indented comment\n", (file) => {
      const target = {};
      loadEnv(file, target);
      assert.deepEqual(target, { KEY: "value" });
    });
  });

  test("skips lines with no '='", () => {
    withEnvFile("not-a-valid-line\nKEY=value\n", (file) => {
      const target = {};
      loadEnv(file, target);
      assert.deepEqual(target, { KEY: "value" });
    });
  });

  test("strips surrounding whitespace around key and value", () => {
    withEnvFile("  KEY  =   value with spaces  \n", (file) => {
      const target = {};
      loadEnv(file, target);
      assert.equal(target.KEY, "value with spaces");
    });
  });

  test("strips one or more layers of surrounding quotes", () => {
    withEnvFile('SINGLE=\'quoted\'\nDOUBLE="quoted"\nNESTED=\'\'both\'\'\n', (file) => {
      const target = {};
      loadEnv(file, target);
      assert.equal(target.SINGLE, "quoted");
      assert.equal(target.DOUBLE, "quoted");
      assert.equal(target.NESTED, "both");
    });
  });

  test("strips trailing CR (Windows line endings)", () => {
    withEnvFile("KEY=value\r\nOTHER=value2\r\n", (file) => {
      const target = {};
      loadEnv(file, target);
      assert.equal(target.KEY, "value");
      assert.equal(target.OTHER, "value2");
    });
  });

  test("tolerates a UTF-8 BOM on the first line", () => {
    withEnvFile("﻿KEY=value\n", (file) => {
      const target = {};
      loadEnv(file, target);
      assert.equal(target.KEY, "value");
    });
  });

  test("value may itself contain an '=' (only the first splits)", () => {
    withEnvFile("APCA_BASE_URL=https://paper-api.alpaca.markets?x=1\n", (file) => {
      const target = {};
      loadEnv(file, target);
      assert.equal(target.APCA_BASE_URL, "https://paper-api.alpaca.markets?x=1");
    });
  });
});
