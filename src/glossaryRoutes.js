// ============================================================
// Glossary route. Serves one row per language out of Postgres, which
// server.js syncs from memory/glossary{,.nl,.fr,.es}.md on every boot — those
// four files stay the git-tracked edit source. Only English is section-
// extracted (the file carries an editors' header block that is not glossary
// content); the translations are already serve-ready.
//
// This route exists because server.js deliberately does not statically expose
// memory/. Falls back to reading the file off disk for local dev without a
// database. Read-only reference data — no auth needed.
// ============================================================
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from './db.js';
import { extractGlossarySections } from './glossaryExtract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, '..', 'memory');

// Allow-listed so `?lang=` can never be interpolated into a path — the file
// fallback below reads from disk by name.
const LANG_FILES = {
  en: 'glossary.md',
  nl: 'glossary.nl.md',
  fr: 'glossary.fr.md',
  es: 'glossary.es.md',
};

function normalizeLang(raw) {
  const lang = String(raw || 'en').slice(0, 2).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LANG_FILES, lang) ? lang : 'en';
}

export function installGlossaryRoutes(app) {
  app.get('/api/glossary', async (req, res) => {
    const lang = normalizeLang(req.query.lang);
    try {
      const row = await db.getGlossary(lang);
      if (row) return res.json({ ...row, lang });
      // A language whose row has not synced yet (e.g. an older build is still
      // serving, or that file failed to read at boot) falls back to English
      // rather than 404ing — a glossary in the wrong language is far better
      // than a dead tab, and the client labels what it got via `lang`.
      if (lang !== 'en') {
        const en = await db.getGlossary('en');
        if (en) return res.json({ ...en, lang: 'en' });
      }
    } catch (e) {
      console.error('[glossary] db read failed, falling back to file:', e?.message || e);
    }
    // Local dev without a database configured: read the file straight off disk.
    try {
      const raw = await readFile(join(MEMORY_DIR, LANG_FILES[lang]), 'utf8');
      // Only English needs section extraction; the translations are already
      // serve-ready (see server.js's GLOSSARY_SOURCES comment).
      return res.json({ content: lang === 'en' ? extractGlossarySections(raw) : raw.trim(), updatedAt: null, lang });
    } catch (e) {
      return res.status(404).json({ error: 'glossary unavailable' });
    }
  });
}
