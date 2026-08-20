const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');

const credentialsRoutes = require('./routes/credentials');
const ledgerCredentialRoutes = require('./routes/ledgerCredential');
const cardsRoutes = require('./routes/cards');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use(express.json());

  // Each route declares its own required scope (requireApiKey) rather
  // than gating per-router here — same reasoning as services/payments'
  // own app.js.
  app.use('/v1/tenants', credentialsRoutes);
  app.use('/v1/tenants', ledgerCredentialRoutes);
  app.use('/v1/tenants', cardsRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
