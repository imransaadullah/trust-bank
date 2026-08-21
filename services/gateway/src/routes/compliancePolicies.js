// Proxies compliance policy view/publish for the tenant admin dashboard.
// Admin-tier only (requireAdminAccess — accepts either a gw_live_ admin
// key or a gws_live_ staff-session-derived GatewaySession, see
// middleware/auth.js), and always calls Compliance with the tenant's
// admin-scope credential (scope: 'admin'), never the operate-scope one
// the existing kyc-tier-check/device-check decisioning routes use — see
// TenantBackendCredential's schema comment for why these are two
// separate stored credentials.
const express = require('express');
const { requireAdminAccess } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const auth = [requireAdminAccess(), resolveEffectiveTenant];
const ADMIN_SCOPE = { scope: 'admin' };
const ADMIN_SCOPE_CREATED = { scope: 'admin', statusCode: 201 };

function qs(params) {
  // URLSearchParams stringifies an undefined value as the literal string
  // "undefined" rather than omitting the key — caught live: an unset
  // jurisdiction query param reached Compliance as jurisdiction=undefined,
  // a real (non-matching) value, so Compliance's own `jurisdiction || 'NG'`
  // default never kicked in and every lookup 404'd. Filter first.
  const defined = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  const s = new URLSearchParams(defined).toString();
  return s ? `?${s}` : '';
}

router.get('/:tenantId/compliance/kyc-policy', auth,
  proxyRoute('compliance', 'GET', (req) =>
    `/v1/tenants/${req.effectiveTenantId}/compliance/kyc-policy${qs({ tier: req.query.tier, jurisdiction: req.query.jurisdiction })}`,
    ADMIN_SCOPE));
router.post('/:tenantId/compliance/kyc-policy', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/kyc-policy`, ADMIN_SCOPE_CREATED));

router.get('/:tenantId/compliance/device-policy', auth,
  proxyRoute('compliance', 'GET', (req) =>
    `/v1/tenants/${req.effectiveTenantId}/compliance/device-policy${qs({ jurisdiction: req.query.jurisdiction })}`,
    ADMIN_SCOPE));
router.post('/:tenantId/compliance/device-policy', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/device-policy`, ADMIN_SCOPE_CREATED));

router.get('/:tenantId/compliance/loan-eligibility-policy', auth,
  proxyRoute('compliance', 'GET', (req) =>
    `/v1/tenants/${req.effectiveTenantId}/compliance/loan-eligibility-policy${qs({ jurisdiction: req.query.jurisdiction })}`,
    ADMIN_SCOPE));
router.post('/:tenantId/compliance/loan-eligibility-policy', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/loan-eligibility-policy`, ADMIN_SCOPE_CREATED));

router.get('/:tenantId/compliance/card-issuance-policy', auth,
  proxyRoute('compliance', 'GET', (req) =>
    `/v1/tenants/${req.effectiveTenantId}/compliance/card-issuance-policy${qs({ jurisdiction: req.query.jurisdiction })}`,
    ADMIN_SCOPE));
router.post('/:tenantId/compliance/card-issuance-policy', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/card-issuance-policy`, ADMIN_SCOPE_CREATED));

router.get('/:tenantId/compliance/monitoring-policy', auth,
  proxyRoute('compliance', 'GET', (req) =>
    `/v1/tenants/${req.effectiveTenantId}/compliance/monitoring-policy${qs({ jurisdiction: req.query.jurisdiction })}`,
    ADMIN_SCOPE));
router.post('/:tenantId/compliance/monitoring-policy', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/monitoring-policy`, ADMIN_SCOPE_CREATED));

module.exports = router;
