// ============================================================
// Glossary route — Suite roadmap: "Add glossary to the database instead of
// loading it from a file." memory/glossary.md remains the git-tracked source
// (server.js syncs its content into Postgres on boot); this route serves the
// DB row so it works in production, where server.js never statically exposes
// memory/. Falls back to reading the file straight off disk for local dev
// without a DB configured. Read-only reference data — no auth needed.
// ============================================================
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from './db.js';

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
      const content = await readFile(GLOSSARY_FILE, 'utf8');
      return res.json({ content, updatedAt: null });
    } catch (e) {
      return res.status(404).json({ error: 'glossary unavailable' });
    }
  });
}
