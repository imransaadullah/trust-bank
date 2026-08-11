const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { requireSharedSecret } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const policiesRoutes = require('./routes/policies');
const decisionsRoutes = require('./routes/decisions');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/v1/tenants', requireSharedSecret, policiesRoutes);
  app.use('/v1/tenants', requireSharedSecret, decisionsRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
