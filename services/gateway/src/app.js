const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');
const apiKeysRoutes = require('./routes/apiKeys');
const backendCredentialsRoutes = require('./routes/backendCredentials');
const sandboxRoutes = require('./routes/sandbox');
const accountsRoutes = require('./routes/accounts');
const identityRoutes = require('./routes/identity');
const complianceRoutes = require('./routes/compliance');
const cardsRoutes = require('./routes/cards');

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

  // Admin-tier: provisioning. Sandbox/production-tier: the actual
  // proxied banking routes a bank's engineers integrate against.
  app.use('/v1/tenants', apiKeysRoutes);
  app.use('/v1/tenants', backendCredentialsRoutes);
  app.use('/v1/tenants', sandboxRoutes);
  app.use('/v1/tenants', accountsRoutes);
  app.use('/v1/tenants', identityRoutes);
  app.use('/v1/tenants', complianceRoutes);
  app.use('/v1/tenants', cardsRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
