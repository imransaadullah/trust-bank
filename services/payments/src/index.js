const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const reconciliationRunner = require('./services/reconciliationRunner');

const app = createApp();
const reconciliationTimer = reconciliationRunner.start();

const server = app.listen(config.port, () => {
  logger.info(`Payments service listening on :${config.port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(reconciliationTimer);
  server.close(() => process.exit(0));
});
