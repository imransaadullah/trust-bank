const https = require('https');
const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { getServerOptions } = require('./tls/mtls');
const usageRollupRunner = require('./services/usageRollupRunner');

const app = createApp();
const usageRollupTimer = usageRollupRunner.start();

const tlsOptions = getServerOptions();
const server = tlsOptions
  ? https.createServer(tlsOptions, app).listen(config.port, config.bindHost, () => {
      logger.info(`Gateway service listening on ${config.bindHost}:${config.port} (mTLS required)`);
    })
  : app.listen(config.port, config.bindHost, () => {
      logger.info(`Gateway service listening on ${config.bindHost}:${config.port}`);
    });

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(usageRollupTimer);
  server.close(() => process.exit(0));
});
