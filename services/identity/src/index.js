const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const delinquencyRunner = require('./services/delinquencyRunner');
const creditBureauRunner = require('./services/creditBureauRunner');

const app = createApp();

const server = app.listen(config.port, config.bindHost, () => {
  logger.info(`Identity service listening on ${config.bindHost}:${config.port}`);
});

const delinquencyTimer = delinquencyRunner.start();
const creditBureauTimer = creditBureauRunner.start();

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  clearInterval(delinquencyTimer);
  clearInterval(creditBureauTimer);
  server.close(() => process.exit(0));
});
