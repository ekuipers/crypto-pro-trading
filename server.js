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

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: pkg.version, time: new Date().toISOString() });
});

app.use('/js', express.static(join(__dirname, 'src', 'js')));
app.use('/css', express.static(join(__dirname, 'src', 'css')));
app.use(express.static(join(__dirname, 'client', 'dist')));
app.use(express.static(join(__dirname, 'docs')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'client', 'dist', 'index.html'));
});

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`CryptoPro Trader listening on http://localhost:${PORT}`);
  });
}

export default app;
