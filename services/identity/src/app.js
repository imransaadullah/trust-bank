const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const branchesRoutes = require('./routes/branches');
const approvalsRoutes = require('./routes/approvals');
const accountsRoutes = require('./routes/accounts');
const loansRoutes = require('./routes/loans');
const passwordResetRoutes = require('./routes/passwordReset');
const staffRoutes = require('./routes/staff');
const complianceCasesRoutes = require('./routes/complianceCases');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use(authRoutes);
  app.use(meRoutes);
  app.use(branchesRoutes);
  app.use(approvalsRoutes);
  app.use(accountsRoutes);
  app.use(loansRoutes);
  app.use(passwordResetRoutes);
  app.use(staffRoutes);
  app.use(complianceCasesRoutes);

  // Staff back-office console (Phase 6) — static build output of
  // admin-console/, mirroring services/gateway's own /docs mount but
  // with an SPA fallback: this is a real client-routed app (React
  // Router), unlike Gateway's single-page Redoc doc, so an unmatched
  // path under /console (e.g. a hard refresh on /console/approvals/abc)
  // needs to still serve index.html rather than 404 — express.static
  // itself already handles the case where the exact asset file exists.
  // Mounted after every API route above so /v1/* and /health are never
  // shadowed by it, and before errorHandler so a genuinely missing
  // asset still 404s normally.
  app.use('/console', express.static(path.join(__dirname, '../public')));
  app.get(/^\/console(\/.*)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
