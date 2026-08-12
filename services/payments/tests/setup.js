// Baseline env so config/index.js doesn't throw on require() during tests
// that don't care about these specific values. Tests that do care
// (tenantSecrets.test.js) override PAYMENTS_ENCRYPTION_KEY themselves.
process.env.PAYMENTS_ENCRYPTION_KEY = process.env.PAYMENTS_ENCRYPTION_KEY || 'a'.repeat(64);
process.env.LEDGER_API_KEY = process.env.LEDGER_API_KEY || 'test-key';
process.env.LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:8080';
