import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Footer.jsx's "Last modified" date was a literal in the JSX that had to be
  // bumped by hand, and was already a day stale when the 2026-07-30 roadmap
  // rescan found it. Stamp the build instead — the footer then can't disagree
  // with what is deployed. (Suite does the same thing server-side, off the
  // deployment artifacts' mtime, because it has no bundler.)
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
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
