// src/env.js
//
// Tiny zero-dependency .env loader -- a faithful port of scripts/_env.py.
// Looks for a `.env` file at the project root (one level up from this
// src/ directory) and pushes any KEY=VALUE lines into process.env. Strips
// surrounding whitespace, quotes, and CR characters so Windows-style line
// endings and quoted values don't sneak into HTTP headers.
//
// Existing environment variables always win over .env values, so the file
// is a default, not an override -- this is why CI-injected secrets (set
// directly as job env vars, no .env file in CI) always take precedence over
// anything a local .env might contain.
//
// Deviates from strict Python parity for testability: loadEnv() takes the
// file path and target env object as parameters (defaulting to the real
// project .env and process.env) instead of only being a load-on-import side
// effect, so tests can call it directly with an injected object.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV_PATH = path.join(__dirname, "..", ".env");

function lstripChars(s, chars) {
  let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}

function rstripChars(s, chars) {
  let j = s.length;
  while (j > 0 && chars.includes(s[j - 1])) j--;
  return s.slice(0, j);
}

function stripChars(s, chars) {
  return rstripChars(lstripChars(s, chars), chars);
}

/**
 * Parse a .env file at envPath and set any KEY=VALUE pairs into targetEnv
 * that aren't already present there (existing values always win). Silently
 * no-ops if the file doesn't exist. Returns the number of keys set.
 */
export function loadEnv(envPath = DEFAULT_ENV_PATH, targetEnv = process.env) {
  if (!existsSync(envPath)) return 0;
  const raw = readFileSync(envPath, "utf-8");
  let set = 0;
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    line = lstripChars(line, "﻿"); // tolerate UTF-8 BOM
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    value = stripChars(value, "'");
    value = stripChars(value, '"');
    value = rstripChars(value, "\r");
    if (key && !(key in targetEnv)) {
      targetEnv[key] = value;
      set++;
    }
  }
  return set;
}

// Auto-load on import, mirroring scripts/_env.py -- importing this module
// anywhere is enough.
loadEnv();
