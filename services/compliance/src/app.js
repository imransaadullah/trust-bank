const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');
const policiesRoutes = require('./routes/policies');
const decisionsRoutes = require('./routes/decisions');
const monitoringRoutes = require('./routes/monitoring');
const credentialsRoutes = require('./routes/credentials');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Each route declares its own required scope (requireApiKey, in
  // middleware/auth.js) rather than gating per-router here — see
  // services/payments' app.js for why a router-level auth middleware at
  // a shared path prefix doesn't work with Express's fallthrough.
  app.use('/v1/tenants', policiesRoutes);
  app.use('/v1/tenants', decisionsRoutes);
  app.use('/v1/tenants', monitoringRoutes);
  app.use('/v1/tenants', credentialsRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
