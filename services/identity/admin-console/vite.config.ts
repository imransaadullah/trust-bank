import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/console/' matches app.js's express.static mount — every built
// asset URL resolves correctly once served under that path. The dev
// proxy means api/client.ts can hard-code relative /v1/... paths with
// no env-var base URL in either dev or prod: in dev this proxies to the
// identity service's own dev server; in prod the browser already loaded
// the page from the same origin/port that also serves /v1/*.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: {
    proxy: {
      '/v1': 'http://localhost:8085',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
