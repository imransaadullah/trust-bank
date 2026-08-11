const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.port, config.bindHost, () => {
  logger.info(`TrustPay backend listening on ${config.bindHost}:${config.port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
