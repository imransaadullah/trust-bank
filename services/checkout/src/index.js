const https = require('https');
const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { getServerOptions } = require('./tls/mtls');
const merchantWebhookRunner = require('./services/merchantWebhookRunner');

const app = createApp();
const merchantWebhookTimer = merchantWebhookRunner.start();

const tlsOptions = getServerOptions();
const server = tlsOptions
  ? https.createServer(tlsOptions, app).listen(config.port, config.bindHost, () => {
      logger.info(`Checkout service listening on ${config.bindHost}:${config.port} (mTLS required)`);
    })
  : app.listen(config.port, config.bindHost, () => {
      logger.info(`Checkout service listening on ${config.bindHost}:${config.port}`);
    });

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(merchantWebhookTimer);
  server.close(() => process.exit(0));
});
