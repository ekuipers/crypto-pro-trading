import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
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
