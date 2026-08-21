// Proxies a request to Ledger/Payments/Compliance/Cards as the calling
// tenant, through a per-backend circuit breaker so one backend's
// trouble can't cascade into failing calls to the others (or hang every
// caller for the backend's own timeout on every single request).
//
// The backends don't share a calling convention — a real, pre-existing
// wrinkle documented in trustpay-backend's own README ("paymentsClient.js
// and complianceClient.js both unwrap response.data.data... the Ledger
// (Go) does not"), plus the Ledger authenticates via an X-Tenant-Id
// header where the Node services take the tenant in the URL path.
// `BACKENDS` below encodes both differences once, so route handlers
// never see them.
const axios = require('axios');
const CircuitBreaker = require('opossum');
const config = require('../config');
const logger = require('../utils/logger');
const tenantBackendCredentialService = require('./tenantBackendCredentialService');
const { getHttpsAgent } = require('../tls/mtls');
const { BackendUnavailableError } = require('../utils/errors');

const BACKENDS = {
  ledger: { baseUrl: config.ledger.baseUrl, tenantVia: 'header' },
  payments: { baseUrl: config.payments.baseUrl, tenantVia: 'path' },
  compliance: { baseUrl: config.compliance.baseUrl, tenantVia: 'path' },
  cards: { baseUrl: config.cards.baseUrl, tenantVia: 'path' },
  checkout: { baseUrl: config.checkout.baseUrl, tenantVia: 'path' },
};

async function rawCall(service, { method, path, tenantId, data, scope = 'operate' }) {
  const backend = BACKENDS[service];
  const token = await tenantBackendCredentialService.get(tenantId, service, scope);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (backend.tenantVia === 'header') headers['X-Tenant-Id'] = tenantId;

  const response = await axios({
    method, url: `${backend.baseUrl}${path}`, data, headers,
    httpsAgent: getHttpsAgent(),
    timeout: 15000,
  });
  // Payments/Compliance (Node) wrap every response in {success,data};
  // the Ledger (Go) doesn't — unwrap here so route handlers get the
  // payload directly regardless of which backend answered.
  return backend.tenantVia === 'path' ? response.data.data : response.data;
}

// One breaker per backend service, built once at module load — Ledger
// trouble shouldn't trip Payments' or Compliance's breaker.
const breakers = {};
for (const service of Object.keys(BACKENDS)) {
  const breaker = new CircuitBreaker((args) => rawCall(service, args), {
    timeout: config.circuitBreaker.timeoutMs,
    errorThresholdPercentage: config.circuitBreaker.errorThresholdPercentage,
    resetTimeout: config.circuitBreaker.resetTimeoutMs,
    volumeThreshold: config.circuitBreaker.volumeThreshold,
    // A busy day of ordinary business-logic rejections (insufficient
    // balance, a bad request) is not the backend being unhealthy — only
    // count network errors and 5xx toward the breaker opening. A 4xx
    // still rejects and reaches the caller exactly as it would without
    // a breaker in front; it just doesn't count against the backend.
    errorFilter: (err) => err.response && err.response.status < 500,
  });
  breaker.on('open', () => logger.warn(`[BackendProxy] circuit opened for ${service} — failing fast until it recovers`));
  breaker.on('halfOpen', () => logger.info(`[BackendProxy] circuit half-open for ${service}, testing recovery`));
  breaker.on('close', () => logger.info(`[BackendProxy] circuit closed for ${service}, recovered`));
  breakers[service] = breaker;
}

/**
 * @param {'ledger'|'payments'|'compliance'|'cards'} service
 * @param {{method: string, path: string, tenantId: string, data?: object, scope?: 'operate'|'admin'}} opts
 */
async function call(service, opts) {
  const breaker = breakers[service];
  try {
    return await breaker.fire(opts);
  } catch (err) {
    if (err.code === 'EOPENBREAKER' || breaker.opened) {
      throw new BackendUnavailableError(service);
    }
    throw err;
  }
}

module.exports = { call, breakers };
