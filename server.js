// CryptoPro Trader — Node.js entrypoint.
// Serves the dashboard's built React app (client/dist, built via `npm run
// build` -> `vite build`), plus its CSS/JS served from src/css and src/js
// (30 classic, non-module scripts the React shell loads dynamically after
// mount — see client/src/scriptLoader.js), and remaining static assets
// (favicons, dashboard_layout.md) from /docs. It also hosts the live trading
// engine: src/cronRoutes.js runs evaluate/watchdog as Vercel Cron-triggered
// serverless functions. See CLAUDE.md "Cron engine".
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { installAuthRoutes, currentUid } from './src/auth.js';
import { installCronRoutes } from './src/cronRoutes.js';
import { installCredentialsRoutes } from './src/credentialsRoutes.js';
import { installStrategyConfigRoutes } from './src/strategyConfigRoutes.js';
import { cryptoEnabled } from './src/secretsCrypto.js';
import { installGlossaryRoutes } from './src/glossaryRoutes.js';
import { extractGlossarySections } from './src/glossaryExtract.js';
import * as db from './src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const app = express();
const PORT = process.env.PORT || 3000;

// Correct client IP behind a reverse proxy (Vercel) — needed for auth's
// per-IP rate limiting.
app.set('trust proxy', 1);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: pkg.version, time: new Date().toISOString() });
});

// CSRF mitigation for the auth API: reject mutating /api/* requests whose
// Origin/Referer host doesn't match this app's own host. SameSite=Lax on the
// session cookie is the primary defense; this is a second layer.
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
app.use((req, res, next) => {
  if (!MUTATING.has(req.method) || !req.path.startsWith('/api/')) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch { /* fall through to reject */ }
  res.status(403).json({ error: 'Cross-origin request rejected' });
});

app.use(express.json({ limit: '2mb' }));

// A malformed JSON body throws before any route's try/catch, and Node's
// SyntaxError message embeds a snippet of the offending input — which, on
// POST /api/alpaca-credentials/:mode, is a fragment of an API secret. Answer
// with a fixed string instead of letting express's default handler decide.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  return next(err);
});

// Multi-user auth (SSO) — accounts & sessions persist in the same Supabase
// Postgres database as the rest of CryptoPro Suite. See src/db.js.
installAuthRoutes(app);

// Vercel Cron (or a manual dashboard trigger) drives the evaluate and
// watchdog engines. See src/cronRoutes.js.
installCronRoutes(app);

// Each signed-in account stores its own Alpaca API credentials, encrypted at
// rest with TRADER_CREDENTIALS_ENC_KEY, and the dispatcher runs per tenant.
// See src/credentialsRoutes.js and CLAUDE.md "Multi-tenant engine".
installCredentialsRoutes(app);

// The write surface for the per-user strategy/risk overrides the Settings JSON
// editor edits. Validates against
// CONFIG_SPEC and rejects, where the engine's read path merely drops bad keys.
// See src/strategyConfigRoutes.js.
installStrategyConfigRoutes(app);
// Surface a missing encryption key at boot rather than only when a user hits
// a 503 — same "warn loudly, keep serving" convention as db.js's dbEnabled().
if (!cryptoEnabled()) {
  console.warn('[credentials] TRADER_CREDENTIALS_ENC_KEY not set (or not 32 bytes base64) — per-user Alpaca credential storage is disabled');
}

// Suite roadmap: glossary served from the database instead of a file — see
// src/glossaryRoutes.js. These stay the git-tracked edit sources; they are
// synced into Postgres below, after db.init() succeeds, one row per language.
// Suite rule 20 applies: adding or reworking a term means editing all four,
// and src/glossaryParity.test.js fails the build if they drift apart.
export const GLOSSARY_SOURCES = [
  ['en', 'glossary.md'],
  ['nl', 'glossary.nl.md'],
  ['fr', 'glossary.fr.md'],
  ['es', 'glossary.es.md'],
];

installGlossaryRoutes(app);

// Dashboard settings sync (Suite roadmap: save user state in the database so
// it follows the account across devices/browsers). One row per account (or
// the GUEST sentinel when signed out) holding theme/lastTab/watchlist/
// backtest-defaults/mode/limits — never API credentials or live Autopilot
// runtime state, which stay in this browser's localStorage only. See
// src/js/settings-sync.js for the client side and exactly what's included.
app.get('/api/session', async (req, res) => {
  try {
    const data = await db.getLayout(await currentUid(req), db.SESSION_NAME);
    if (data == null) return res.status(404).json(null);
    res.json(data);
  } catch (e) {
    console.error('[api] get session:', e.message);
    res.status(500).json(null);
  }
});

app.put('/api/session', async (req, res) => {
  try {
    await db.putLayout(await currentUid(req), db.SESSION_NAME, req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error('[api] put session:', e.message);
    res.status(500).json({ error: String(e.message) });
  }
});

app.use('/js', express.static(join(__dirname, 'src', 'js')));
app.use('/css', express.static(join(__dirname, 'src', 'css')));
app.use(express.static(join(__dirname, 'client', 'dist')));
app.use(express.static(join(__dirname, 'docs')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'client', 'dist', 'index.html'));
});

db.init()
  .then(async (ok) => {
    if (!ok) return;
    // Sync the git-tracked source files into Postgres on every boot so the DB
    // rows never drift from whatever was last committed (cheap no-op write
    // when content is unchanged — see db.putGlossary's `is distinct from`
    // guard).
    //
    // English comes from memory/glossary.md, of which only the "Acronyms &
    // Abbreviations" and "Trading Terms" sections are kept — the file also
    // carries a header block for editors, which is not glossary content.
    //
    // The translations are separate, already-serve-ready files holding just
    // those two sections, so they are stored verbatim. That is why they are
    // not run through extractGlossarySections(): it matches the two *English*
    // level-2 headings, so a translated heading would extract to "" and the
    // tab would silently fall back to English. Keeping them extraction-free
    // means the headings can be translated like everything else.
    for (const [lang, file] of GLOSSARY_SOURCES) {
      try {
        const raw = readFileSync(join(__dirname, 'memory', file), 'utf8');
        await db.putGlossary(lang === 'en' ? extractGlossarySections(raw) : raw.trim(), lang);
      } catch (e) {
        // Per language: a missing or unreadable translation must not stop the
        // others (or English) from syncing.
        console.error(`[glossary] startup sync failed for ${lang}:`, e?.message || e);
      }
    }
  })
  .catch(e => console.error('[db] init failed:', e?.message || e))
  .finally(() => {
    if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`CryptoPro Trader listening on http://localhost:${PORT}`);
      });
    }
  });

export default app;
