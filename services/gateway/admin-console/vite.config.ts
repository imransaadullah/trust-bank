import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/console/' matches app.js's express.static mount — every built
// asset URL resolves correctly once served under that path. The dev
// proxy means api/client.ts can hard-code relative /v1/... paths with
// no env-var base URL in either dev or prod: in dev this proxies to the
// gateway service's own dev server; in prod the browser already loaded
// the page from the same origin/port that also serves /v1/*.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: {
    proxy: {
      '/v1': 'http://localhost:8084',
    },
  },
  build: {
    // NOT '../public' — that directory already holds the checked-in,
    // hand-written Redoc docs page served at /docs (index.html, init.js,
    // redoc.standalone.js). A shared outDir with emptyOutDir:true would
    // silently delete those on every console build. A subdirectory keeps
    // emptyOutDir scoped to just the console's own build output.
    outDir: '../public/console',
    emptyOutDir: true,
  },
});
