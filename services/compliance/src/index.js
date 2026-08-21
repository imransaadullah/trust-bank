const https = require('https');
const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { getServerOptions } = require('./tls/mtls');
const sanctionsFeedRunner = require('./services/sanctionsFeedRunner');

const app = createApp();

const tlsOptions = getServerOptions();
const server = tlsOptions
  ? https.createServer(tlsOptions, app).listen(config.port, config.bindHost, () => {
      logger.info(`Compliance service listening on ${config.bindHost}:${config.port} (mTLS required)`);
    })
  : app.listen(config.port, config.bindHost, () => {
      logger.info(`Compliance service listening on ${config.bindHost}:${config.port}`);
    });

const sanctionsFeedTimer = sanctionsFeedRunner.start();

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(sanctionsFeedTimer);
  server.close(() => process.exit(0));
});
