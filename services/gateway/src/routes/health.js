// Liveness vs. readiness, genuinely separate — every other service in
// this platform only has liveness ("is the process up"). /ready pings
// each backend's own /health directly (not through backendProxy's
// circuit breakers — a readiness check should reflect real-time backend
// state, not be affected by or affect breaker state) and only reports
// ready if every backend answers. This is the resilience signal a bank's
// own ops team would actually look for.
const express = require('express');
const axios = require('axios');
const config = require('../config');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.get('/ready', async (req, res) => {
  const backends = {
    ledger: config.ledger.baseUrl,
    payments: config.payments.baseUrl,
    compliance: config.compliance.baseUrl,
    cards: config.cards.baseUrl,
  };

  const checks = {};
  await Promise.all(Object.entries(backends).map(async ([name, baseUrl]) => {
    try {
      await axios.get(`${baseUrl}/health`, { timeout: 3000 });
      checks[name] = 'ok';
    } catch {
      checks[name] = 'unreachable';
    }
  }));

  const allHealthy = Object.values(checks).every((status) => status === 'ok');
  res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? 'ready' : 'not_ready', backends: checks });
});

module.exports = router;
