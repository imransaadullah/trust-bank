// Proxies Checkout's merchant-management routes for the TENANT ADMIN
// DASHBOARD (services/gateway/admin-console) — a bank's own admin
// viewing/managing their merchants' webhook config on the merchant's
// behalf (e.g. the merchant is locked out of their own OTP-based
// login). Distinct namespace (/admin/merchants, not /merchants) from
// checkout.js's own banking-tier merchant routes just above in the
// route list: those are for a tenant's own BACKEND integration
// (requireApiKey, sandbox/production tier); these are for a human
// browsing the admin-console (requireAdminAccess — gw_live_ admin key
// or a gws_live_ staff-session-derived GatewaySession), same split
// compliancePolicies.js already draws against compliance.js. Always
// calls Checkout with the tenant's admin-scope credential (scope:
// 'admin'), a separate stored TenantBackendCredential from the
// operate-scope one the banking-tier routes use — see
// deploy/provision-tenant.sh's checkout_admin_gateway.token step.
const express = require('express');
const { requireAdminAccess } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const auth = [requireAdminAccess(), resolveEffectiveTenant];
const ADMIN_SCOPE = { scope: 'admin' };
const ADMIN_SCOPE_CREATED = { scope: 'admin', statusCode: 201 };

router.get('/:tenantId/admin/merchants', auth,
  proxyRoute('checkout', 'GET', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants`, ADMIN_SCOPE));

router.get('/:tenantId/admin/merchants/:merchantId', auth,
  proxyRoute('checkout', 'GET', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants/${req.params.merchantId}`, ADMIN_SCOPE));

router.patch('/:tenantId/admin/merchants/:merchantId', auth,
  proxyRoute('checkout', 'PATCH', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants/${req.params.merchantId}`, ADMIN_SCOPE));

router.post('/:tenantId/admin/merchants/:merchantId/webhook-secret/rotate', auth,
  proxyRoute('checkout', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants/${req.params.merchantId}/webhook-secret/rotate`, ADMIN_SCOPE_CREATED));

module.exports = router;
