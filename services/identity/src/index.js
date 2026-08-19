const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const delinquencyRunner = require('./services/delinquencyRunner');

const app = createApp();

const server = app.listen(config.port, config.bindHost, () => {
  logger.info(`Identity service listening on ${config.bindHost}:${config.port}`);
});

const delinquencyTimer = delinquencyRunner.start();

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(delinquencyTimer);
  server.close(() => process.exit(0));
});
