// Baseline env so config/index.js doesn't throw on require() during tests
// that don't care about these specific values. Tests that do care
// (tenantSecrets.test.js) override PAYMENTS_ENCRYPTION_KEY themselves.
process.env.PAYMENTS_SHARED_SECRET = process.env.PAYMENTS_SHARED_SECRET || 'test-secret';
process.env.PAYMENTS_ENCRYPTION_KEY = process.env.PAYMENTS_ENCRYPTION_KEY || 'a'.repeat(64);
process.env.LEDGER_SHARED_SECRET = process.env.LEDGER_SHARED_SECRET || 'test-secret';
process.env.LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:8080';
