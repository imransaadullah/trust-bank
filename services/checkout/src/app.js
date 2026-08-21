const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');

const credentialsRoutes = require('./routes/credentials');
const ledgerCredentialRoutes = require('./routes/ledgerCredential');
const checkoutConfigRoutes = require('./routes/checkoutConfig');
const merchantsRoutes = require('./routes/merchants');
const checkoutSessionsRoutes = require('./routes/checkoutSessions');
const checkoutWebhooksRoutes = require('./routes/checkoutWebhooks');
const hostedPageRoutes = require('./routes/hostedPage');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Webhooks need the raw body for signature verification — mounted
  // before express.json() so it never gets re-serialized. Authenticated
  // by the provider's own signature, not an operate credential. Same
  // reasoning as services/cards' own app.js.
  app.use('/v1/webhooks', express.raw({ type: '*/*' }), checkoutWebhooksRoutes);

  // Public, unauthenticated — the hosted pay page and its Noop
  // /simulate affordance. Reachable directly (own Caddy site block,
  // deploy/Caddyfile.example), never through the Gateway, since an
  // anonymous customer holds no tenant API key. Mounted before
  // express.json() is irrelevant here (GET-only plus one small POST
  // body on /simulate) but kept alongside webhooks for the same "public,
  // unauthenticated surface" grouping.
  app.use('/pay', hostedPageRoutes);

  app.use(express.json());

  // Each route declares its own required scope (requireApiKey) rather
  // than gating per-router here — same reasoning as services/cards' own
  // app.js. Admin-only routes (credentials/ledger-credential/
  // checkout-config) are never Gateway-proxied; operate routes
  // (merchants/checkout-sessions) are.
  app.use('/v1/tenants', credentialsRoutes);
  app.use('/v1/tenants', ledgerCredentialRoutes);
  app.use('/v1/tenants', checkoutConfigRoutes);
  app.use('/v1/tenants', merchantsRoutes);
  app.use('/v1/tenants', checkoutSessionsRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
