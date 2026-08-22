const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');

const credentialsRoutes = require('./routes/credentials');
const ledgerCredentialRoutes = require('./routes/ledgerCredential');
const checkoutConfigRoutes = require('./routes/checkoutConfig');
const merchantsRoutes = require('./routes/merchants');
const checkoutSessionsRoutes = require('./routes/checkoutSessions');
const merchantLoginRoutes = require('./routes/merchantLogin');
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

  // Merchant dashboard (services/checkout/admin-console) — a merchant
  // viewing their own checkout sessions/webhook deliveries. A third,
  // deliberate exception to "only /pay/* and /v1/webhooks/* are public"
  // on this same domain — unlike those two, this one IS credential-gated
  // (MerchantSession), so it needs its own SPA-fallback route the same
  // way identity's and gateway's own consoles already do, since this is
  // a real client-routed React Router app, not a static doc page.
  app.use('/merchant', express.static(path.join(__dirname, '../public/merchant')));
  app.get(/^\/merchant(\/.*)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/merchant/index.html'));
  });

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
  app.use('/v1/tenants', merchantLoginRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
