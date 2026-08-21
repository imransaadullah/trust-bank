import { apiRequest } from './client';
import type { SandboxMapping } from '../types/api';

// Read-only by design — POST /:tenantId/sandbox exists on the backend,
// but it's registered by deploy/provision-tenant.sh's platform-admin
// flow (it creates the twin tenant itself via Ledger's own
// platform-admin-only POST /v1/tenants first), never by a tenant's own
// admin key. Building a "provision" button here would dangle an action
// no tenant could actually complete. Throws ApiError with status 404 and
// code SANDBOX_NOT_PROVISIONED when no twin exists yet — the caller
// should treat that as an empty state, not a failure.
export function getSandbox() {
  return apiRequest<SandboxMapping>('/sandbox');
}
