const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { requireSharedSecret } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const tenantConfigRoutes = require('./routes/tenantConfig');
const accountsRoutes = require('./routes/accounts');
const identityRoutes = require('./routes/identity');
const payoutsRoutes = require('./routes/payouts');
const webhooksRoutes = require('./routes/webhooks');

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

  app.use('/v1/tenants', requireSharedSecret, tenantConfigRoutes);
  app.use('/v1/tenants', requireSharedSecret, accountsRoutes);
  app.use('/v1/tenants', requireSharedSecret, identityRoutes);
  app.use('/v1/tenants', requireSharedSecret, payoutsRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
