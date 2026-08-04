// Pulls just the stable reference sections out of memory/glossary.md — the
// user only wants "Acronyms & Abbreviations" and "Trading Terms" served as
// the glossary, not the header block that precedes them
// of the file (implementation-detail notes on specific features/bugs, not
// glossary terms). memory/glossary.md itself is untouched — this only
// affects what gets synced into the database / served over /api/glossary.
const DEFAULT_HEADINGS = ['Acronyms & Abbreviations', 'Trading Terms'];

/**
 * @param {string} md - full glossary.md content
 * @param {string[]} [headings] - level-2 (`## `) heading titles to keep, in the order they appear in `md`
 * @returns {string} the matched sections joined by `---`, or "" if none matched
 */
export function extractGlossarySections(md, headings = DEFAULT_HEADINGS) {
  const wanted = new Set(headings);
  const lines = (md || '').split(/\r?\n/);
  const headingLines = [];
  lines.forEach((line, i) => {
    const m = line.match(/^##\s+(.*)/);
    if (m) headingLines.push({ i, title: m[1].trim() });
  });

  const sections = [];
  headingLines.forEach((h, k) => {
    if (!wanted.has(h.title)) return;
    const end = k + 1 < headingLines.length ? headingLines[k + 1].i : lines.length;
    const body = lines.slice(h.i, end);
    let last = body[body.length - 1];
    while (body.length && (!last.trim() || /^-{3,}$/.test(last.trim()))) {
      body.pop();
      last = body[body.length - 1];
    }
    sections.push(body.join('\n'));
  });
  return sections.join('\n\n---\n\n');
}
