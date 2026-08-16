const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');

const tenantConfigRoutes = require('./routes/tenantConfig');
const ledgerCredentialRoutes = require('./routes/ledgerCredential');
const credentialsRoutes = require('./routes/credentials');
const accountsRoutes = require('./routes/accounts');
const identityRoutes = require('./routes/identity');
const payoutsRoutes = require('./routes/payouts');
const webhooksRoutes = require('./routes/webhooks');
const reconciliationRoutes = require('./routes/reconciliation');
const billsConfigRoutes = require('./routes/billsConfig');
const billsRoutes = require('./routes/bills');
const billsReconciliationRoutes = require('./routes/billsReconciliation');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Webhooks need the raw body for signature verification — mounted
  // before express.json() so it never gets re-serialized. Authenticated
  // by the provider's own signature, not the shared secret.
  app.use('/v1/webhooks', express.raw({ type: '*/*' }), webhooksRoutes);

  app.use(express.json());

  // Each route declares its own required scope (see middleware/auth.js's
  // requireApiKey) rather than gating per-router here — Express runs
  // every app.use() matching a path prefix in sequence when a router
  // doesn't match, so a router-level auth middleware here would run (and
  // could reject) requests meant for a *different* router mounted at the
  // same '/v1/tenants' prefix, before that router ever got a chance to
  // not-match and pass through.
  app.use('/v1/tenants', tenantConfigRoutes);
  app.use('/v1/tenants', ledgerCredentialRoutes);
  app.use('/v1/tenants', credentialsRoutes);
  app.use('/v1/tenants', accountsRoutes);
  app.use('/v1/tenants', identityRoutes);
  app.use('/v1/tenants', payoutsRoutes);
  app.use('/v1/tenants', reconciliationRoutes);
  app.use('/v1/tenants', billsConfigRoutes);
  app.use('/v1/tenants', billsRoutes);
  app.use('/v1/tenants', billsReconciliationRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
