const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const reconciliationRunner = require('./services/reconciliationRunner');
const billsReconciliationRunner = require('./services/billsReconciliationRunner');

const app = createApp();
const reconciliationTimer = reconciliationRunner.start();
const billsReconciliationTimer = billsReconciliationRunner.start();

const server = app.listen(config.port, config.bindHost, () => {
  logger.info(`Payments service listening on ${config.bindHost}:${config.port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(reconciliationTimer);
  clearInterval(billsReconciliationTimer);
  server.close(() => process.exit(0));
});
