# Network topology

Ledger, Payments, Compliance, Cards, Checkout, and Identity are never meant
to be reachable from the public internet as a *credentialed API surface* —
only two things ever are: TrustPay Backend (or, for a future tenant,
whatever product backend they run), and the gateway (`services/gateway`).
Different audiences, both legitimately public: a product backend serves
that tenant's own end-user app (JWT-authenticated consumers); the gateway
serves *external bank/developer* integration — tiered API keys, rate
limited, one gateway process shared across every tenant, proxying to
Ledger/Payments/Compliance/Cards/Checkout's existing APIs rather than
exposing them directly. Identity (`services/identity` — staff login, MFA,
RBAC, branches; Phase 2.5) is internal back-office tooling, same posture
as Ledger/Payments/Compliance: nothing a bank's own developers or a
consumer app ever calls directly. All eight services bind `127.0.0.1` by
default (`BIND_HOST` in each `.env`); this is enforced at the process
level, not left to a firewall rule someone has to remember to add.

**Checkout's hosted pay page and inbound provider webhook are the one
narrow, deliberate exception** (Phase 6) — see the dedicated section below.
Everything else about Checkout (merchant/checkout-session CRUD) follows
the same loopback-only, gateway-proxied rule as Cards.

This holds across all three deployment models the platform needs to
support, but it means something slightly different in each one — network
position alone ("private subnet") stops being a sufficient control the
moment a deployment splits across hosts, which is why per-caller scoped
credentials (`SERVICE_CREDENTIAL_MODEL.md`, repo root — replaced the old
shared secrets) stay in effect on every service-to-service call
regardless of topology.

## SaaS (all eight services on infra we control)

The common case: one VPS (or a small set we operate), all eight services
plus Postgres. Everything defaults to loopback-only; `Caddyfile.example`
proxies three public site blocks — one to TrustPay Backend (the consumer
app's own domain), one to the gateway (the API/developer-facing domain),
and one path-scoped block to Checkout (see below) — and nothing else. No
further setup needed — same-host `localhost` calls between services work
exactly as before this change.

`install.sh` (this directory) provisions exactly this topology on a fresh
Ubuntu 22.04/24.04 box — system deps, all eight services built/migrated/
running under systemd, Caddy wired up. `provision-tenant.sh` onboards a
tenant onto an already-installed box, including issuing the gateway its
own per-tenant Ledger/Payments/Compliance/Cards/Checkout credentials (the
gateway is multi-tenant, unlike the product backend, so it can't just hold
one credential per backend in its own `.env` — see `services/gateway/
prisma/schema.prisma`'s `TenantBackendCredential` comment). See
`README.md` for the full runbook.

## Checkout's public surface — the one narrow exception (Phase 6)

Every rule above holds for Checkout's own merchant/checkout-session CRUD
API — loopback-only, reached only through the gateway, exactly like Cards.
But a hosted checkout page is only useful if an anonymous customer's
browser can actually load it, and an inbound provider webhook (Paystack or
otherwise) is only useful if the provider's servers can actually reach it
— neither holds a tenant API key, so neither can go through the gateway's
API-key-gated proxy the way every other cross-service call in this
platform does.

The resolution: Checkout itself stays loopback-bound like every other
service (`BIND_HOST=127.0.0.1`, same as Ledger/Payments/Compliance/Cards/
Identity). Only two specific path prefixes — `/pay/*` (the hosted page)
and `/v1/webhooks/*` (the inbound provider webhook, authenticated by its
own signature, not a credential) — are exposed via their own path-scoped
Caddy site block, on their own domain (`Caddyfile.example`'s
`pay.trustbank.example.com` block), distinct from both TrustPay Backend's
and the gateway's audiences. This is a real, narrow addition to "only two
things are public," not a general loosening of it: no other path on
Checkout's own port is ever proxied, and every other service's posture is
completely unchanged.

Session ids are UUIDs, not practically enumerable — deliberately no rate
limiting on this public surface this slice, matching how a real Paystack
checkout link works in the real world (see `services/checkout/README.md`
for what else is named as out of scope).

## On-prem (a bank/MFB runs everything inside their own perimeter)

The customer's own network team owns the perimeter (firewall, VPN, DMZ
policy) — that's usually a prerequisite of their own security review, not
something we add. The loopback-only default matches what they already
expect from internal banking systems and removes a likely audit finding
rather than creating deployment friction.

## Hybrid (split across networks — e.g. Ledger stays on-prem for data
residency, Payments/Compliance/Backend run in our cloud)

"Bind to a private interface" isn't sufficient here — there's no shared
subnet once the halves are in different physical or cloud locations. Set
up a private tunnel between the sites (WireGuard is the pragmatic,
cheap-to-operate choice for a small team; a cloud provider's VPC
peering/VPN gateway works the same way if both halves are cloud-hosted)
and set `BIND_HOST` on the split-off service to the tunnel interface's
address instead of `127.0.0.1` — never `0.0.0.0`. Point the caller's
`*_SERVICE_URL` env var at that tunnel address. The scoped credential on
every request is what keeps this safe even though the two halves are now
talking over a real (if private) network rather than loopback.

**mTLS — built, opt-in.** Credential scoping (`SERVICE_CREDENTIAL_MODEL.md`)
closed the "any caller can act as any tenant" gap and made every
credential revocable, but a bearer token over a WireGuard tunnel is still
just a bearer token — mTLS adds mutual, certificate-based caller identity
on top. `deploy/generate-mtls-certs.sh` generates an internal, self-signed
CA plus one leaf certificate per service (1-year validity, idempotent —
reruns skip anything that already exists). Every service can require and
verify a client certificate on its inbound side, and every
service-to-service caller can present its own leaf cert outbound
(`internal/tlsconfig` in the Ledger, `src/tls/mtls.js` in each Node
service). Off by default (`MTLS_ENABLED=false`) — on the default
loopback-only SaaS topology this defends against nothing, so it stays
fully inert until turned on for whichever services actually cross an
untrusted network in a real hybrid deployment:

```
MTLS_ENABLED=true
MTLS_CERT_FILE=/path/to/<service>.crt
MTLS_KEY_FILE=/path/to/<service>.key
MTLS_CA_FILE=/path/to/ca.crt
```

**Still open: automated rotation and revocation checking (CRL/OCSP).**
Same reasoning as before — real PKI lifecycle management is ongoing
operational burden not worth automating before there's live hybrid
volume to justify it. Rotate manually today: delete the specific
`<service>.crt`/`.key` under `$SECRETS_DIR/mtls` and rerun
`generate-mtls-certs.sh`.
