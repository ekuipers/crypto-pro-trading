// CryptoPro Trader — Node.js entrypoint.
// Serves the dashboard's built React app (client/dist, built via `npm run
// build` -> `vite build`), plus its CSS/JS served from src/css and src/js
// (30 classic, non-module scripts the React shell loads dynamically after
// mount — see client/src/scriptLoader.js), and remaining static assets
// (favicons, dashboard_layout.md) from /docs. The live trading engine itself
// is still 100% Python, run via GitHub Actions cron (scripts/*.py) — this
// server has no trading logic, just the dashboard frontend + a health check.
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { installAuthRoutes, currentUid } from './src/auth.js';
import { installCronRoutes } from './src/cronRoutes.js';
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

// Multi-user auth (SSO) — accounts & sessions persist in the same Supabase
// Postgres database as the rest of CryptoPro Suite. See src/db.js.
installAuthRoutes(app);

// Cron cutover (Suite roadmap, "For Trader only") — Vercel Cron (or a
// manual dashboard trigger) drives the Node evaluation/watchdog/daily-
// summary engines instead of GitHub Actions. See src/cronRoutes.js.
installCronRoutes(app);

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
  .catch(e => console.error('[db] init failed:', e?.message || e))
  .finally(() => {
    if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`CryptoPro Trader listening on http://localhost:${PORT}`);
      });
    }
  });

export default app;
