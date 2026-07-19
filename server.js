// CryptoPro Trader — minimal Node.js entrypoint.
// Serves the static dashboard from /docs (mirrors CryptoPro Suite/Charts'
// server.js layout) so this repo has a valid Vercel entrypoint. The live
// trading engine itself is still 100% Python, run via GitHub Actions cron
// (scripts/*.py) — this server has no trading logic, just static hosting
// + a health check.
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: pkg.version, time: new Date().toISOString() });
});

app.use(express.static(join(__dirname, 'docs')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'docs', 'dashboard_professional.html'));
});

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`CryptoPro Trader listening on http://localhost:${PORT}`);
  });
}

export default app;
