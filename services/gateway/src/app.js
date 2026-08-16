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

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use(healthRoutes);

  // Admin-tier: provisioning. Sandbox/production-tier: the actual
  // proxied banking routes a bank's engineers integrate against.
  app.use('/v1/tenants', apiKeysRoutes);
  app.use('/v1/tenants', backendCredentialsRoutes);
  app.use('/v1/tenants', sandboxRoutes);
  app.use('/v1/tenants', accountsRoutes);
  app.use('/v1/tenants', identityRoutes);
  app.use('/v1/tenants', complianceRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
