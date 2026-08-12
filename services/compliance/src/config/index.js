require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`config: ${name} is required`);
  }
  return value;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8083', 10),
  // Loopback only by default — never internet-facing. Override to a
  // private/VPN interface IP for a hybrid deployment; never 0.0.0.0.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
};
