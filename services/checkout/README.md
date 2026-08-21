# Checkout

Hosted checkout — payment links/sessions, a hosted pay page, merchant-facing
webhooks on completion (Phase 6, final item). A tenant's own merchant
customer hands their buyer a link; the buyer pays on a hosted page; the
merchant gets webhooked and their own Ledger wallet is credited. Distinct
from `services/payments`, which moves money once it's already been
collected — this is the surface that collects it — and distinct from
`services/gateway`, which is the API contract *tenants* integrate against,
not their merchants'.

Never touches raw card data, by design, not by discipline alone — see
`../../CORE_BANKING_PLATFORM_ARCHITECTURE.md` section 7's requirement
that card data live in a PCI-DSS-scoped enclave a certified third party
owns. The hosted pay page (`src/views/hostedPage.js`) only ever renders a
plain link to the provider's own already-PCI-compliant hosted page —
never an `<input>` for card data.

Multi-tenant from day one — own Postgres DB, own scoped admin/operate
credentials (`src/services/credentialService.js`, same model every other
Node service uses), and its own stored per-tenant Ledger operate credential
(`src/services/tenantLedgerCredentialService.js`, mirrors `services/cards`'
own `TenantLedgerCredential`). Merchant settlement reuses the Ledger's
existing `ConfirmDeposit` primitive directly — zero new Ledger code.

## What's real vs. what's a placeholder

**Real, and verified live against a real Ledger and gateway:**
- **Merchant onboarding** (`POST /v1/tenants/:tenantId/merchants`) — opens
  a real Ledger wallet account (`OpenAccount`, `externalCustomerId:
  merchant.id`) *before* the local `Merchant` row is ever written, so a
  failed Ledger call never leaves a merchant half-onboarded. Verified live:
  the resulting Ledger account is directly queryable via `GET
  /v1/customers/:externalCustomerId/account` on the Ledger itself.
- **Checkout sessions** (`POST /v1/tenants/:tenantId/checkout-sessions`) —
  a real state machine (`pending → processing → paid | failed | expired |
  cancelled`). `processing` exists specifically to make the inbound
  webhook handler safe against a retry racing a mid-flight Ledger call:
  the CAS `pending → processing` makes a duplicate webhook a genuine
  no-op, and a Ledger failure reverts `processing → pending` so a later
  retry can still complete it — verified live by deleting the tenant's
  stored Ledger credential mid-flight, confirming the session correctly
  reverted rather than getting stuck, then restoring the credential and
  confirming a retry completed it correctly.
- **The hosted pay page** (`GET /pay/:sessionId`) — a hand-written HTML
  page (no view engine), states for `pending`/`processing` (a plain "Pay
  now" link to `authorizationUrl`), `paid`, `expired`, and `cancelled`.
  Runs `syncFromProviderIfNeeded` on every read — if still pending and the
  provider isn't `noop`, calls `verifyTransaction` and completes the
  session inline if the provider already reports success, covering the
  race between a customer's redirect-back and the provider's own webhook.
  Expiry is checked lazily at read time (no cron needed).
- **Merchant webhook delivery** — `MerchantWebhookDelivery` +
  `src/services/merchantWebhookRunnerService.js`, a Node port of the
  Ledger's own outbox (`services/ledger/internal/outbox/outbox.go`) claim/
  deliver/retry shape: `SELECT ... FOR UPDATE SKIP LOCKED`, deliver,
  `delivered` or increment `retryCount` up to `maxRetries` then `failed`
  — no exponential backoff, same accepted limitation `outbox.go` already
  has. `X-Checkout-Signature: sha256=<hmac>`, verified live byte-for-byte
  against the merchant's own decrypted webhook secret.
- **The `CheckoutProvider` contract** (`src/providers/checkoutProvider.js`)
  — `initializeTransaction`/`verifyTransaction`/`verifyWebhookSignature`/
  `parseWebhookEvent`, mirrors `services/cards`' `CardIssuingProvider`
  pattern. `NoopCheckoutProvider` is the only provider live-verified end
  to end this slice — its `authorizationUrl` points at this service's own
  `GET /pay/:sessionId/simulate` page, and a real "Pay now" click there
  posts a real, self-signed webhook through the *exact same*
  `checkoutWebhookService.handleProviderWebhook()` the real inbound route
  uses, not a shortcut around it.

**Real code, not live-verified against the real third party:**
- `PaystackCheckoutProvider` (`src/providers/paystackCheckoutProvider.js`)
  — real HTTP shape against Paystack's actual `/transaction/initialize`
  and `/transaction/verify/:reference`, the same base URL, secret-key auth
  header, and HMAC-SHA512 webhook scheme `services/payments`' own
  `PaystackProvider` already uses live. Reuses the same underlying
  Paystack merchant account a tenant already configured there — a
  different, standard endpoint on the same API, not a new commercial
  relationship — but keeps its own separate encrypted credential store
  here (`TenantCheckoutProviderConfig`), per this platform's convention of
  never sharing credentials across service boundaries. Shape-verified
  only (correct request/response field mapping, correct signature check)
  — live-verify against a real test-mode secret key once one is
  available in an environment that has it.

**Explicit placeholders, named not hidden:**
- **No merchant suspend/update** — create/get/list only.
- **No refunds.**
- **No split-payment / platform-fee entries** — would need a new 3-leg
  Ledger primitive (customer → merchant → platform fee), not the 2-leg
  `ConfirmDeposit` this slice uses. A real "Checkout v2" item, not scoped
  here.
- **No webhook backoff strategy** — linear retry only, same limitation
  `outbox.go` already accepts.
- **No failed-session reissue** — the tenant creates a new session.
- **No rate limiting on the public `/pay/*`/`/v1/webhooks/*` surface** —
  session ids are UUIDs, not practically enumerable; a documented
  decision matching how a real Paystack checkout link works, not an
  oversight.

## Network position — the one deliberate exception in this platform

Every other route in this service (`credentials`, `ledger-credential`,
`checkout-config`, `merchants`, `checkout-sessions`) is loopback-only and
reached only through `services/gateway`, exactly like Cards. `/pay/*` and
`/v1/webhooks/*` are the one exception: a hosted pay page has to be
reachable by an anonymous customer's browser, and an inbound provider
webhook has to be reachable by the provider's own servers — neither holds
a tenant API key. Resolved via a narrow, path-scoped Caddy site block on
its own domain (`../../deploy/Caddyfile.example`), not a general loosening
of "only the gateway/trustpay-backend are public" — see
`../../deploy/NETWORK_TOPOLOGY.md`'s own section on this.

## Setup

```bash
cp .env.example .env   # fill in DATABASE_URL, CHECKOUT_ENCRYPTION_KEY, CHECKOUT_PUBLIC_BASE_URL
npm install
npx prisma migrate deploy
npm start
```

Bootstrap the first admin credential for a tenant (chicken-and-egg fix,
same as every other service):

```bash
node scripts/bootstrapKey.js --tenant-id <id> --scope admin --label ops-bootstrap
```

Normally both of the above are handled by `../../deploy/provision-tenant.sh`.
