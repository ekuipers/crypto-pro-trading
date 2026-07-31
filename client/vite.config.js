import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PROXY_TARGET = 'http://localhost:3000';

// Newest `## vYYYY-MM-DD.N` heading in memory/memory.md — the changelog entry
// the footer's version claims to correspond to. See the `define` block below.
function readMemoryVersion() {
  try {
    const memory = join(dirname(fileURLToPath(import.meta.url)), '..', 'memory', 'memory.md');
    const match = readFileSync(memory, 'utf8').match(/^##\s+(v[\d.\-]+)/m);
    if (match) return match[1];
  } catch { /* fall through */ }
  return `build-${new Date().toISOString().slice(0, 10)}`;
}

export default defineConfig({
  plugins: [react()],
  // Footer.jsx's "Last modified" date was a literal in the JSX that had to be
  // bumped by hand, and was already two days stale when the 2026-07-31 roadmap
  // rescan found it. Stamp the build instead — the footer then can't disagree
  // with what is deployed. (Suite does the same thing server-side, off the
  // deployment artifacts' mtime, because it has no bundler.)
  //
  // The version beside it was left manual in that same change, on the reasoning
  // that it tracks memory.md entries rather than builds. It then drifted twice
  // in one day (shipped as .5 while memory.md was already at .7), so it is
  // derived too now — read from the newest `## vX` heading in memory.md, which
  // IS the thing it claims to track. Falls back to the build date if that file
  // ever moves, so a rename degrades the footer instead of breaking the build.
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __APP_VERSION__: JSON.stringify(readMemoryVersion()),
  },
  server: {
    proxy: {
      '/js': PROXY_TARGET,
      '/css': PROXY_TARGET,
      '/api': PROXY_TARGET,
      '/favicon.svg': PROXY_TARGET,
      '/favicon.ico': PROXY_TARGET,
      '/favicon-32.png': PROXY_TARGET,
      '/apple-touch-icon.png': PROXY_TARGET,
    },
  },
  build: {
    outDir: 'dist',
  },
});
