// ============================================================
// Glossary route — Suite roadmap: "Add glossary to the database instead of
// loading it from a file." Only the "Acronyms & Abbreviations" and "Trading
// Terms" sections of memory/glossary.md are served — the rest of that file
// is a dated implementation changelog, not glossary content (user
// correction, 2026-07-24). memory/glossary.md remains the git-tracked
// source in full (server.js extracts + syncs just those sections into
// Postgres on boot); this route serves the DB row so it works in
// production, where server.js never statically exposes memory/. Falls back
// to reading the file straight off disk (same extraction) for local dev
// without a DB configured. Read-only reference data — no auth needed.
// ============================================================
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from './db.js';
import { extractGlossarySections } from './glossaryExtract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOSSARY_FILE = join(__dirname, '..', 'memory', 'glossary.md');

export function installGlossaryRoutes(app) {
  app.get('/api/glossary', async (req, res) => {
    try {
      const row = await db.getGlossary();
      if (row) return res.json(row);
    } catch (e) {
      console.error('[glossary] db read failed, falling back to file:', e?.message || e);
    }
    try {
      const raw = await readFile(GLOSSARY_FILE, 'utf8');
      return res.json({ content: extractGlossarySections(raw), updatedAt: null });
    } catch (e) {
      return res.status(404).json({ error: 'glossary unavailable' });
    }
  });
}
