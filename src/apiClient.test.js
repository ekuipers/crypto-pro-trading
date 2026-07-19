// src/apiClient.test.js
//
// Tests for the apiClient.js retry/backoff wrapper (port of scripts/_api.py).
// Uses backoffSeconds near-zero overrides instead of real multi-second
// sleeps, per apiRequest's per-call override support.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "./testUtils/fetchStub.js";
import { apiRequest, apiGet, apiPost, apiDelete, HttpError } from "./apiClient.js";

const FAST = { maxAttempts: 3, backoffSeconds: 0.001 };

let stub;
afterEach(() => {
  stub?.restore();
});

describe("apiRequest — happy path", () => {
  test("returns the response on the first 2xx", async () => {
    stub = stubFetch([{ status: 200, body: { ok: true } }]);
    const res = await apiRequest("GET", "https://example.test/v2/account", FAST);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(stub.calls.length, 1);
  });

  test("apiGet/apiPost/apiDelete dispatch the correct HTTP method", async () => {
    stub = stubFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 204, body: {} }]);
    await apiGet("https://example.test/x", FAST);
    await apiPost("https://example.test/x", { ...FAST, json: { a: 1 } });
    await apiDelete("https://example.test/x", FAST);
    assert.equal(stub.calls[0].init.method, "GET");
    assert.equal(stub.calls[1].init.method, "POST");
    assert.equal(stub.calls[1].init.body, JSON.stringify({ a: 1 }));
    assert.equal(stub.calls[2].init.method, "DELETE");
  });

  test("params are appended as a query string", async () => {
    stub = stubFetch([{ status: 200, body: {} }]);
    await apiRequest("GET", "https://example.test/v2/orders", {
      ...FAST,
      params: { status: "open", limit: 100 },
    });
    const url = new URL(stub.calls[0].url);
    assert.equal(url.searchParams.get("status"), "open");
    assert.equal(url.searchParams.get("limit"), "100");
  });
});

describe("apiRequest — retry policy", () => {
  test("retries on 5xx and succeeds on a later attempt", async () => {
    stub = stubFetch([{ status: 503, body: {} }, { status: 200, body: { ok: true } }]);
    const res = await apiRequest("GET", "https://example.test/x", FAST);
    assert.equal(res.status, 200);
    assert.equal(stub.calls.length, 2);
  });

  test("does NOT retry on 4xx — fails immediately", async () => {
    stub = stubFetch([{ status: 401, body: { message: "unauthorized" } }, { status: 200, body: {} }]);
    await assert.rejects(
      () => apiRequest("GET", "https://example.test/x", FAST),
      (e) => e instanceof HttpError && e.status === 401
    );
    assert.equal(stub.calls.length, 1, "must not have attempted a second call");
  });

  test("exhausts all attempts on persistent 5xx and throws the last error", async () => {
    stub = stubFetch([{ status: 500, body: {} }, { status: 502, body: {} }, { status: 503, body: {} }]);
    await assert.rejects(
      () => apiRequest("GET", "https://example.test/x", FAST),
      (e) => e instanceof HttpError && e.status === 503
    );
    assert.equal(stub.calls.length, 3);
  });

  test("retries on a network error (fetch throws) and can still succeed", async () => {
    const original = globalThis.fetch;
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) throw new TypeError("network error");
      return { ok: true, status: 200, statusText: "", json: async () => ({ ok: true }) };
    };
    try {
      const res = await apiRequest("GET", "https://example.test/x", FAST);
      assert.equal(res.status, 200);
      assert.equal(call, 2);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("backoff doubles each attempt", async () => {
    stub = stubFetch([{ status: 500, body: {} }, { status: 500, body: {} }, { status: 200, body: {} }]);
    const waits = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => {
      waits.push(ms);
      return realSetTimeout(fn, 0);
    };
    try {
      await apiRequest("GET", "https://example.test/x", { maxAttempts: 3, backoffSeconds: 1 });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    assert.deepEqual(waits, [1000, 2000]);
  });
});
