const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const branchesRoutes = require('./routes/branches');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use(authRoutes);
  app.use(meRoutes);
  app.use(branchesRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
