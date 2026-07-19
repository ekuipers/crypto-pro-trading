// src/apiClient.js
//
// Shared HTTP helper with exponential-backoff retry for all Alpaca API
// calls -- a faithful port of scripts/_api.py, built on Node 20's built-in
// global fetch (no new npm dependency).
//
// Retry policy is loaded from config.json (api.max_retry_attempts and
// api.retry_backoff_seconds) at import time, same pattern as risk.js.
// Falls back to 3 attempts / 5s if the file is missing.
//
// Retryable errors:
//   - HTTP 5xx (server-side, transient)
//   - network errors (fetch throws, e.g. connection reset) / timeouts
//
// Not retried:
//   - HTTP 4xx (client error -- bad auth, bad symbol, etc.)
//
// Mirroring _api_request's max_attempts/backoff_seconds kwargs, apiRequest
// accepts per-call overrides -- tests use this to run with near-zero
// backoff instead of real multi-second sleeps.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

const _cfg = loadConfig();
const _apiCfg = _cfg.api || {};

export const MAX_RETRY_ATTEMPTS = Number(_apiCfg.max_retry_attempts ?? 3);
export const RETRY_BACKOFF_SECONDS = Number(_apiCfg.retry_backoff_seconds ?? 5.0);

/** Raised for any non-2xx HTTP response. */
export class HttpError extends Error {
  constructor(status, statusText, body) {
    super(`HTTP ${status}${statusText ? " " + statusText : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(url, params) {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fetchWithTimeout(url, init, timeoutSeconds) {
  if (!timeoutSeconds) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make an HTTP request with exponential-backoff retry on transient errors.
 *
 * @param {string} method HTTP verb ("GET", "POST", "DELETE", ...)
 * @param {string} url Full URL to call.
 * @param {object} [options]
 * @param {Record<string,string>} [options.headers]
 * @param {Record<string,string|number>} [options.params] Appended as a query string.
 * @param {any} [options.json] JSON-serialized as the request body.
 * @param {number} [options.timeout] Seconds before the request is aborted.
 * @param {number} [options.maxAttempts] Total tries before giving up.
 * @param {number} [options.backoffSeconds] Base wait between retries; doubled each attempt.
 * @returns {Promise<Response>} A fetch Response with a 2xx status.
 * @throws {HttpError} On 4xx (immediate) or 5xx (after retries exhausted).
 */
export async function apiRequest(
  method,
  url,
  {
    headers = {},
    params,
    json,
    timeout,
    maxAttempts = MAX_RETRY_ATTEMPTS,
    backoffSeconds = RETRY_BACKOFF_SECONDS,
  } = {}
) {
  const fullUrl = buildUrl(url, params);
  const init = { method, headers };
  if (json !== undefined) init.body = JSON.stringify(json);

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(fullUrl, init, timeout);
      if (res.ok) return res;
      let body = null;
      try {
        body = await res.json();
      } catch {
        // response had no/invalid JSON body — keep body null
      }
      const err = new HttpError(res.status, res.statusText, body);
      if (res.status < 500) throw err; // 4xx: client mistake, retrying won't help
      lastErr = err;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;
      lastErr = e;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(backoffSeconds * 2 ** attempt * 1000);
    }
  }

  throw lastErr;
}

/** GET with retry. */
export function apiGet(url, options = {}) {
  return apiRequest("GET", url, options);
}

/** POST with retry. */
export function apiPost(url, options = {}) {
  return apiRequest("POST", url, options);
}

/** DELETE with retry. */
export function apiDelete(url, options = {}) {
  return apiRequest("DELETE", url, options);
}
