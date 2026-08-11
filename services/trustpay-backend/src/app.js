const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const kycRoutes = require('./routes/kyc');
const walletRoutes = require('./routes/wallet');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/auth', authRoutes);
  app.use('/kyc', kycRoutes);
  app.use('/wallet', walletRoutes);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
