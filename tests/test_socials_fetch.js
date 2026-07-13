// Unit tests for the Socials tab's Twitter/X fetch logic in
// docs/dashboard_professional.html (socFetchAccount + helpers).
//
// Why a Node harness instead of pytest: this logic is dashboard-only
// client-side JS (no server, no npm build). The test extracts the exact
// function/const source from the live HTML file (so it can never silently
// drift from production) and runs it in a vm context with `fetch` and a
// minimal `document.createElement("textarea")` stub mocked — no network
// calls are made, so this runs offline and in CI.
//
// Run: node tests/test_socials_fetch.js

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const HTML_PATH = path.join(__dirname, "..", "docs", "dashboard_professional.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// Bracket-matching extractor: finds `function <name>(` or `const <name> =`
// and returns the full statement source. Safe here because none of the
// extracted snippets contain braces/semicolons inside string or regex
// literals (verified by reading the source below).
function extractFunction(src, name) {
  let start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error("function not found in HTML: " + name);
  if (src.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const braceStart = src.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function extractConst(src, name) {
  const start = src.indexOf("const " + name + " ");
  if (start === -1) throw new Error("const not found in HTML: " + name);
  const end = src.indexOf(";", start);
  if (end === -1) throw new Error("terminating ';' not found for const: " + name);
  return src.slice(start, end + 1);
}

const source = [
  extractConst(html, "SOC_NITTER_HOSTS"),
  extractConst(html, "SOC_MAX_PER_ACCT"),
  extractConst(html, "SOC_CRYPTO_RE"),
  extractFunction(html, "socTgFeedUrl"),
  extractFunction(html, "socCleanText"),
  extractFunction(html, "socToXUrl"),
  extractFunction(html, "socFetchAccount"),
].join("\n\n");

// Minimal <textarea> stub matching real browser behaviour: setting
// innerHTML on a textarea decodes HTML character references but does NOT
// parse nested tags (textarea is a "raw text" element per the HTML spec).
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function makeSandbox(fetchImpl) {
  const sandbox = {
    fetch: fetchImpl,
    console,
    document: {
      createElement: () => {
        const el = { _html: "" };
        Object.defineProperty(el, "innerHTML", {
          set(v) { el._html = v; el.value = decodeEntities(v); },
          get() { return el._html; },
        });
        return el;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "socials-extract.js" });
  return sandbox;
}

function rss2json(status, feedTitle, items) {
  return { status, feed: { title: feedTitle }, items };
}

test("socCleanText decodes entities, collapses whitespace, does not parse nested tags", () => {
  const sandbox = makeSandbox(async () => { throw new Error("fetch should not be called"); });
  assert.equal(
    sandbox.socCleanText("Bitcoin &amp; Ethereum   just   pumped <b>hard</b>\n\nnow"),
    "Bitcoin & Ethereum just pumped <b>hard</b> now"
  );
});

test("socToXUrl rewrites a Nitter mirror link back to x.com and strips #m", () => {
  const sandbox = makeSandbox(async () => { throw new Error("fetch should not be called"); });
  assert.equal(
    sandbox.socToXUrl("https://xcancel.com/testuser/status/1700000000000000000#m", "xcancel.com"),
    "https://x.com/testuser/status/1700000000000000000"
  );
});

test("Telegram mirror success: returns items, filters retweets and media-only posts", async () => {
  const acct = { h: "binance", tg: "binance_announcements" };
  const sandbox = makeSandbox(async (url) => {
    assert.match(url, /TelegramBridge/);
    assert.match(url, /binance_announcements/);
    return {
      ok: true,
      status: 200,
      json: async () => rss2json("ok", "Binance Announcements (@binance_announcements) - Telegram", [
        { title: "New listing: FOO/USD trading pair now live!", link: "https://t.me/binance_announcements/1234", pubDate: "2026-07-13 10:00:00" },
        { title: "RT by someone: an old retweet", link: "https://t.me/binance_announcements/1235", pubDate: "2026-07-13 09:00:00" },
        { title: "Please open Telegram to view this media", link: "https://t.me/binance_announcements/1236", pubDate: "2026-07-13 08:00:00" },
      ]),
    };
  });
  const items = await sandbox.socFetchAccount(acct);
  assert.equal(items.length, 1);
  assert.equal(items[0].via, "tg");
  assert.equal(items[0].text, "New listing: FOO/USD trading pair now live!");
  assert.equal(items[0].url, "https://t.me/binance_announcements/1234");
});

test("Blocked Nitter mirror (fake 200 'not yet whitelisted' feed) is rejected, not rendered as tweets", async () => {
  // Regression test for the 2026-07-10 bug: xcancel answers HTTP 200 with an
  // error feed instead of a real timeline. The account handle must appear in
  // the feed title or the feed is rejected.
  const acct = { h: "elonmusk" };
  const sandbox = makeSandbox(async () => ({
    ok: true,
    status: 200,
    json: async () => rss2json("ok", "RSS reader not yet whitelisted!", [
      { title: "this must never be treated as a real tweet", link: "https://xcancel.com/x", pubDate: "2026-07-13 10:00:00" },
    ]),
  }));
  await assert.rejects(
    () => sandbox.socFetchAccount(acct),
    (err) => err.message.includes("@elonmusk") && /blocks RSS readers/i.test(err.message)
  );
});

test("Working Nitter mirror is accepted and the tweet URL is rewritten to x.com", async () => {
  const acct = { h: "testuser" };
  const sandbox = makeSandbox(async (url) => {
    if (url.includes("xcancel.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => rss2json("ok", "TestUser / @testuser", [
          { title: "Just a crypto bitcoin update", link: "https://xcancel.com/testuser/status/1#m", pubDate: "2026-07-13 10:00:00" },
        ]),
      };
    }
    return { ok: true, status: 200, json: async () => rss2json("error", "", []) };
  });
  const items = await sandbox.socFetchAccount(acct);
  assert.equal(items.length, 1);
  assert.equal(items[0].via, "x");
  assert.equal(items[0].url, "https://x.com/testuser/status/1");
});

test("General (non-crypto-native) account keeps only crypto-keyword posts", async () => {
  const acct = { h: "elonmusk", tg: "elonmusk_tg", general: true };
  const sandbox = makeSandbox(async () => ({
    ok: true,
    status: 200,
    json: async () => rss2json("ok", "Elon Musk (@elonmusk_tg) - Telegram", [
      { title: "Bitcoin and crypto adoption is accelerating", link: "https://t.me/elonmusk_tg/1", pubDate: "2026-07-13 10:00:00" },
      { title: "Great weather in Austin today", link: "https://t.me/elonmusk_tg/2", pubDate: "2026-07-13 09:00:00" },
    ]),
  }));
  const items = await sandbox.socFetchAccount(acct);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Bitcoin/);
});

test("All sources failing throws with the account handle in the message", async () => {
  const acct = { h: "deadaccount" };
  const sandbox = makeSandbox(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await assert.rejects(
    () => sandbox.socFetchAccount(acct),
    (err) => err.message.startsWith("@deadaccount:")
  );
});
