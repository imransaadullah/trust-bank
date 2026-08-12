# Network topology

Ledger, Payments, and Compliance are never meant to be reachable from the
public internet — only TrustPay Backend (or, for a future tenant, whatever
product backend they run) is. All four services bind `127.0.0.1` by
default (`BIND_HOST` in each `.env`); this is enforced at the process
level, not left to a firewall rule someone has to remember to add.

This holds across all three deployment models the platform needs to
support, but it means something slightly different in each one — network
position alone ("private subnet") stops being a sufficient control the
moment a deployment splits across hosts, which is why per-caller scoped
credentials (`SERVICE_CREDENTIAL_MODEL.md`, repo root — replaced the old
shared secrets) stay in effect on every service-to-service call
regardless of topology.

## SaaS (all four services on infra we control)

The common case: one VPS (or a small set we operate), all four services
plus Postgres. Everything defaults to loopback-only; `Caddyfile.example`
is the only process binding a public interface, and it proxies to
TrustPay Backend alone. No further setup needed — same-host `localhost`
calls between services work exactly as before this change.

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

**Still open: mTLS.** Credential scoping (`SERVICE_CREDENTIAL_MODEL.md`)
closed the "any caller can act as any tenant" gap and made every
credential revocable, but a bearer token over a WireGuard tunnel is still
just a bearer token — mTLS would add mutual, certificate-based caller
identity on top. Not built yet: no real hybrid deployment exists to
justify the ongoing PKI operational burden (issuance, rotation,
revocation checking) before there's a reason to carry it. Build this when
an actual hybrid deployment is on the table, not speculatively.
