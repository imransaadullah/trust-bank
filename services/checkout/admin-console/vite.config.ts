import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/merchant/' matches app.js's express.static mount — every built
// asset URL resolves correctly once served under that path. The dev
// proxy means api/client.ts can hard-code relative /v1/... paths with
// no env-var base URL in either dev or prod: in dev this proxies to the
// checkout service's own dev server; in prod the browser already loaded
// the page from the same origin/port that also serves /v1/*.
export default defineConfig({
  base: '/merchant/',
  plugins: [react()],
  server: {
    proxy: {
      '/v1': 'http://localhost:8087',
    },
  },
  build: {
    // A subdirectory, not '../public' bare — same emptyOutDir lesson
    // from services/gateway/admin-console/vite.config.ts: never point
    // outDir at a directory that might hold other checked-in static
    // files (here, the hosted /pay page's own assets under ../public).
    outDir: '../public/merchant',
    emptyOutDir: true,
  },
});
