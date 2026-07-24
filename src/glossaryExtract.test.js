// src/glossaryExtract.test.js

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractGlossarySections } from "./glossaryExtract.js";

const SAMPLE = [
  "# Glossary — Alpaca Trading Agent",
  "",
  "Full decoder ring.",
  "",
  "---",
  "",
  "## 2026-07-22 — Roadmap rescan: something",
  "",
  "| Term | Meaning |",
  "|------|---------|",
  "| foo | bar |",
  "",
  "---",
  "",
  "## Acronyms & Abbreviations",
  "",
  "| Term | Meaning | Context |",
  "|------|---------|---------|",
  "| ATR | Average True Range | Volatility measure |",
  "",
  "---",
  "",
  "## 2026-07-07 — Some other dated section",
  "",
  "- an implementation note",
  "",
  "## Trading Terms",
  "",
  "| Term | Meaning |",
  "|------|---------|",
  "| Confluence score | 6-point TA signal score |",
  "",
  "---",
  "",
  "## Agents",
  "",
  "some agent content",
].join("\n");

describe("extractGlossarySections", () => {
  test("pulls only the Acronyms & Abbreviations and Trading Terms sections, in file order", () => {
    const out = extractGlossarySections(SAMPLE);
    assert.match(out, /^## Acronyms & Abbreviations/);
    assert.match(out, /ATR \| Average True Range/);
    assert.match(out, /## Trading Terms/);
    assert.match(out, /Confluence score/);
    assert.doesNotMatch(out, /Roadmap rescan: something/);
    assert.doesNotMatch(out, /Some other dated section/);
    assert.doesNotMatch(out, /## Agents/);
    // Acronyms section must come before Trading Terms
    assert.ok(out.indexOf("Acronyms") < out.indexOf("Trading Terms"));
  });

  test("trims a trailing --- separator and blank lines off each section", () => {
    const out = extractGlossarySections(SAMPLE);
    assert.doesNotMatch(out.trim(), /-{3,}$/);
  });

  test("returns empty string when no heading matches", () => {
    assert.equal(extractGlossarySections(SAMPLE, ["Nonexistent Heading"]), "");
  });

  test("returns empty string for empty/undefined input", () => {
    assert.equal(extractGlossarySections(""), "");
    assert.equal(extractGlossarySections(undefined), "");
  });

  test("a section that runs to end of file (no trailing heading) is still captured whole", () => {
    const md = ["## Trading Terms", "", "| Term | Meaning |", "|---|---|", "| x | y |"].join("\n");
    const out = extractGlossarySections(md, ["Trading Terms"]);
    assert.match(out, /\| x \| y \|/);
  });
});
