import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Both footer stamps are derived, never typed. They were literals in the JSX
  // and went stale between deploys; a build stamp cannot disagree with what is
  // actually deployed. (Suite does the same server-side, off the deployment
  // artifacts' mtime, because it has no bundler.)
  //
  // __APP_VERSION__ used to read the newest `## vX` heading out of a changelog
  // file. That changelog is gone — git log is the history now — so the version
  // is the build date too. Keep both defines: Footer.jsx renders them.
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __APP_VERSION__: JSON.stringify(`build-${new Date().toISOString().slice(0, 10)}`),
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
