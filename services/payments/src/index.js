const https = require('https');
const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { getServerOptions } = require('./tls/mtls');
const reconciliationRunner = require('./services/reconciliationRunner');
const billsReconciliationRunner = require('./services/billsReconciliationRunner');

const app = createApp();
const reconciliationTimer = reconciliationRunner.start();
const billsReconciliationTimer = billsReconciliationRunner.start();

const tlsOptions = getServerOptions();
const server = tlsOptions
  ? https.createServer(tlsOptions, app).listen(config.port, config.bindHost, () => {
      logger.info(`Payments service listening on ${config.bindHost}:${config.port} (mTLS required)`);
    })
  : app.listen(config.port, config.bindHost, () => {
      logger.info(`Payments service listening on ${config.bindHost}:${config.port}`);
    });

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(reconciliationTimer);
  clearInterval(billsReconciliationTimer);
  server.close(() => process.exit(0));
});
