const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');
const tenantsRoutes = require('./routes/tenants');
const apiKeysRoutes = require('./routes/apiKeys');
const backendCredentialsRoutes = require('./routes/backendCredentials');
const sandboxRoutes = require('./routes/sandbox');
const accountsRoutes = require('./routes/accounts');
const identityRoutes = require('./routes/identity');
const complianceRoutes = require('./routes/compliance');
const compliancePoliciesRoutes = require('./routes/compliancePolicies');
const staffLoginRoutes = require('./routes/staffLogin');
const cardsRoutes = require('./routes/cards');
const checkoutRoutes = require('./routes/checkout');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use(healthRoutes);

  // Developer portal — unauthenticated, same posture as /health: a
  // prospective bank should be able to read the API reference before
  // ever holding a key, and nothing in the spec is sensitive. Redoc
  // renders /openapi.yaml live from disk, so the docs can never drift
  // from what's actually shipped the way a separately-hosted copy could.
  app.get('/openapi.yaml', (req, res) => {
    res.type('yaml').sendFile(path.join(__dirname, '../openapi.yaml'));
  });
  app.use('/docs', express.static(path.join(__dirname, '../public')));

  // Tenant admin dashboard (services/gateway/admin-console) — a bank's
  // own technical/integration admin managing API keys, usage, sandbox
  // status. Served from public/console/, a build-artifact subdirectory
  // of the checked-in /docs static folder above, not the folder itself
  // (see admin-console/vite.config.ts's outDir comment for why). Unlike
  // /docs, this is a real client-routed React Router app, so it needs
  // its own SPA-fallback route for deep links to survive a hard refresh
  // — the same regex shape services/identity's app.js already uses.
  app.use('/console', express.static(path.join(__dirname, '../public/console')));
  app.get(/^\/console(\/.*)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/console/index.html'));
  });

  // Admin-tier: provisioning. Sandbox/production-tier: the actual
  // proxied banking routes a bank's engineers integrate against.
  app.use('/v1/tenants', tenantsRoutes);
  app.use('/v1/tenants', staffLoginRoutes);
  app.use('/v1/tenants', apiKeysRoutes);
  app.use('/v1/tenants', backendCredentialsRoutes);
  app.use('/v1/tenants', sandboxRoutes);
  app.use('/v1/tenants', accountsRoutes);
  app.use('/v1/tenants', identityRoutes);
  app.use('/v1/tenants', complianceRoutes);
  app.use('/v1/tenants', compliancePoliciesRoutes);
  app.use('/v1/tenants', cardsRoutes);
  app.use('/v1/tenants', checkoutRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
