// src/secretsCrypto.test.js

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  credentialAad,
  cryptoEnabled,
  CryptoNotConfigured,
  DecryptFailed,
  ENC_VERSION,
} from "./secretsCrypto.js";

const KEY_ENV = "TRADER_CREDENTIALS_ENC_KEY";
const KEY_A = crypto.randomBytes(32).toString("base64");
const KEY_B = crypto.randomBytes(32).toString("base64");
const PAYLOAD = { keyId: "PKTEST1234567890", secret: "s3cr3t-value", baseUrl: "https://paper-api.alpaca.markets" };
const AAD = credentialAad("alice", "paper");

let saved;
beforeEach(() => { saved = process.env[KEY_ENV]; process.env[KEY_ENV] = KEY_A; });
afterEach(() => { if (saved === undefined) delete process.env[KEY_ENV]; else process.env[KEY_ENV] = saved; });

describe("key configuration", () => {
  test("cryptoEnabled reflects a valid 32-byte base64 key", () => {
    assert.equal(cryptoEnabled(), true);
    delete process.env[KEY_ENV];
    assert.equal(cryptoEnabled(), false);
  });

  test("a wrong-length key is rejected, not silently padded", () => {
    process.env[KEY_ENV] = crypto.randomBytes(16).toString("base64");
    assert.equal(cryptoEnabled(), false);
    assert.throws(() => encryptSecret(PAYLOAD, AAD), CryptoNotConfigured);
  });

  test("a blank/whitespace key is treated as unset", () => {
    process.env[KEY_ENV] = "   ";
    assert.equal(cryptoEnabled(), false);
  });

  test("missing key fails closed on both encrypt and decrypt", () => {
    const blob = encryptSecret(PAYLOAD, AAD);
    delete process.env[KEY_ENV];
    assert.throws(() => encryptSecret(PAYLOAD, AAD), CryptoNotConfigured);
    assert.throws(() => decryptSecret(blob, AAD), CryptoNotConfigured);
  });

  test("the key is read lazily — a key set after import still works", () => {
    delete process.env[KEY_ENV];
    assert.equal(cryptoEnabled(), false);
    process.env[KEY_ENV] = KEY_A;
    assert.deepEqual(decryptSecret(encryptSecret(PAYLOAD, AAD), AAD), PAYLOAD);
  });
});

describe("round trip", () => {
  test("decrypt(encrypt(x)) === x", () => {
    assert.deepEqual(decryptSecret(encryptSecret(PAYLOAD, AAD), AAD), PAYLOAD);
  });

  test("the envelope never contains the plaintext secret", () => {
    const blob = encryptSecret(PAYLOAD, AAD);
    assert.equal(blob.includes(PAYLOAD.secret), false);
    assert.equal(Buffer.from(blob, "base64").toString("utf8").includes(PAYLOAD.secret), false);
  });

  test("a fresh IV per call — same payload never encrypts to the same blob", () => {
    const blobs = new Set(Array.from({ length: 25 }, () => encryptSecret(PAYLOAD, AAD)));
    assert.equal(blobs.size, 25);
  });

  test("envelope layout is iv[12] || tag[16] || ciphertext", () => {
    const buf = Buffer.from(encryptSecret(PAYLOAD, AAD), "base64");
    const ctLen = Buffer.from(JSON.stringify(PAYLOAD), "utf8").length; // GCM is a stream cipher: no padding
    assert.equal(buf.length, 12 + 16 + ctLen);
  });

  test("ENC_VERSION is exported for the forward-compat column", () => {
    assert.equal(ENC_VERSION, 1);
  });
});

describe("tamper + wrong-key handling", () => {
  test("a flipped ciphertext byte fails authentication", () => {
    const buf = Buffer.from(encryptSecret(PAYLOAD, AAD), "base64");
    buf[buf.length - 1] ^= 0xff;
    assert.throws(() => decryptSecret(buf.toString("base64"), AAD), DecryptFailed);
  });

  test("a flipped auth-tag byte fails authentication", () => {
    const buf = Buffer.from(encryptSecret(PAYLOAD, AAD), "base64");
    buf[12] ^= 0xff;
    assert.throws(() => decryptSecret(buf.toString("base64"), AAD), DecryptFailed);
  });

  test("a flipped IV byte fails authentication", () => {
    const buf = Buffer.from(encryptSecret(PAYLOAD, AAD), "base64");
    buf[0] ^= 0xff;
    assert.throws(() => decryptSecret(buf.toString("base64"), AAD), DecryptFailed);
  });

  test("decrypting with a different key fails rather than returning junk", () => {
    const blob = encryptSecret(PAYLOAD, AAD);
    process.env[KEY_ENV] = KEY_B;
    assert.throws(() => decryptSecret(blob, AAD), DecryptFailed);
  });

  test("truncated / empty / non-base64 input is rejected", () => {
    for (const bad of ["", "   ", "not-base64!!", Buffer.alloc(27).toString("base64")]) {
      assert.throws(() => decryptSecret(bad, AAD), DecryptFailed);
    }
  });

  test("null/undefined input is rejected without throwing a TypeError", () => {
    assert.throws(() => decryptSecret(null, AAD), DecryptFailed);
    assert.throws(() => decryptSecret(undefined, AAD), DecryptFailed);
  });
});

describe("AAD binds a ciphertext to its own row", () => {
  test("credentialAad includes the version, uid and mode", () => {
    assert.equal(credentialAad("alice", "paper"), `v${ENC_VERSION}|alice|paper`);
    assert.notEqual(credentialAad("alice", "paper"), credentialAad("alice", "live"));
    assert.notEqual(credentialAad("alice", "paper"), credentialAad("bob", "paper"));
  });

  test("a blob relocated to another user's row fails to decrypt", () => {
    const blob = encryptSecret(PAYLOAD, credentialAad("alice", "paper"));
    assert.throws(() => decryptSecret(blob, credentialAad("mallory", "paper")), DecryptFailed);
  });

  test("a blob relocated to the other mode fails to decrypt", () => {
    const blob = encryptSecret(PAYLOAD, credentialAad("alice", "live"));
    assert.throws(() => decryptSecret(blob, credentialAad("alice", "paper")), DecryptFailed);
  });

  test("the matching AAD still round-trips", () => {
    const aad = credentialAad("alice", "live");
    assert.deepEqual(decryptSecret(encryptSecret(PAYLOAD, aad), aad), PAYLOAD);
  });

  test("the AAD is not stored in the envelope (it is recomputed from the row)", () => {
    const blob = encryptSecret(PAYLOAD, credentialAad("alice", "paper"));
    assert.equal(Buffer.from(blob, "base64").toString("utf8").includes("alice"), false);
  });

  test("a missing or non-string aad is a programming error, not a silent default", () => {
    assert.throws(() => encryptSecret(PAYLOAD), TypeError);
    assert.throws(() => encryptSecret(PAYLOAD, ""), TypeError);
    assert.throws(() => decryptSecret(encryptSecret(PAYLOAD, AAD)), TypeError);
  });
});
