# TrustPay Backend

The product/KYC/UX layer for TrustPay — an OPay-like wallet, the first
real tenant on trust-bank. Owns customer identity and KYC gating; never
touches a provider SDK or a NUBAN algorithm directly, and never hardcodes
a regulatory limit — see `COMPLIANCE_DESIGN_AND_BACKLOG.md`. Everything
money-adjacent goes through three other services:

- **`services/ledger`** (Go) — balance, P2P, deposit/withdrawal recording
- **`services/payments`** (Node) — account provisioning, BVN/NIN checks, payouts
- **`services/compliance`** (Node) — KYC-tier transaction limits, device-binding limits

## What's real vs. what's a placeholder

**Real, verified against live `services/ledger` and `services/payments`
instances during development:**
- Signup → Tier-0 wallet opened on the Ledger automatically
- Balance reads, P2P transfer between two real users (both sides' local
  `Transaction` rows written, balances confirmed exact), transaction
  history
- KYC-tier gating: a Tier-0 user is blocked from `/wallet/withdraw` with
  403, not silently allowed
- JWT auth: valid token accepted, missing/malformed/invalid/foreign-signed
  token all rejected with 401
- The debit-first-then-reverse-on-provider-failure withdrawal ordering —
  forced a real payout failure (see `services/payments`' README) and
  confirmed the customer's ledger balance is restored automatically
- Compliance limits, through the real `/wallet/transfer` and
  `/wallet/withdraw` routes against a live `services/compliance`: a
  Tier-1 user's transfer within the CBN ₦30,000/day limit succeeds, the
  next one that would exceed it is rejected with a specific reason (not
  a generic 500), and — tested as an independent case, not conflated
  with the KYC-tier check — a brand-new device is capped at ₦20,000
  even when well within the KYC-tier daily limit and the user's balance

**Not verified — needs live credentials this environment doesn't have:**
`/auth/send-otp` and `/auth/verify-otp` against a real AuthCore OTP
(the account-creation and wallet-opening code downstream of a successful
verification *was* exercised, just seeded directly rather than reached
via a real OTP round trip), and a *successful* KYC verify/DVA
provisioning/payout (their failure paths were exercised for real instead —
see `services/payments`' README for what that proved).

**Explicit placeholders:**
- No retry route for a user whose signup succeeded but wallet-opening
  failed (`ledgerAccountId` stays null — see the comment in `routes/auth.js`)
- No admin/back-office tooling, no rate limiting beyond what AuthCore's
  own OTP endpoint enforces
- Tier 2/3 KYC verification flows (gov ID + address, beneficial
  ownership) aren't built — `User.kycTier` and `services/compliance`'s
  policy model both support them, only the upgrade UX is missing

## Setup

```bash
createdb trustpay_backend
cp .env.example .env   # then edit it

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustpay_backend
npx prisma migrate deploy

npm install
npm run dev   # :8082, requires the Ledger, Payments, and Compliance services
              # already running, a tenant provisioned on all three (see their
              # READMEs), and a KYC-tier + device-binding policy published on
              # Compliance before any wallet route will work
```

## API

```bash
curl -X POST localhost:8082/auth/send-otp -d '{"phone":"+2348010000000"}'
curl -X POST localhost:8082/auth/verify-otp \
  -d '{"phone":"+2348010000000","code":"123456","deviceId":"<client-generated-device-id>"}'
# -> { token, user: { id, phoneNumber, kycTier, walletReady }, isNewDevice }

curl localhost:8082/wallet/balance -H "Authorization: Bearer $TOKEN"
curl -X POST localhost:8082/wallet/transfer -H "Authorization: Bearer $TOKEN" \
  -d '{"toPhoneNumber":"+2348020000000","amount":5000,"description":"lunch"}'

curl -X POST localhost:8082/kyc/verify-identity -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"bvn","number":"12345678901","firstName":"Ada","lastName":"Lovelace"}'

# requires kycTier >= 1
curl -X POST localhost:8082/wallet/withdraw -H "Authorization: Bearer $TOKEN" \
  -d '{"amount":10000,"beneficiaryAccountNumber":"0123456789","beneficiaryBankCode":"058"}'

curl localhost:8082/wallet/transactions -H "Authorization: Bearer $TOKEN"
```

## Layout

```
prisma/               User, Device, Transaction (local statement cache — the
                       Ledger has no list-entries endpoint yet)
src/services/          authCoreClient, authTokenVerifier (lifted from
                       truechat/backend, JWKS-only), ledgerClient, paymentsClient,
                       complianceClient
src/routes/            auth, kyc, wallet
src/middleware/auth.js  verifies this backend's own JWT (not AuthCore's, not
                       the Ledger's/Payments'/Compliance's shared secrets) and
                       attaches the device claim minted at login
```

## A bug worth knowing about if you're extending this

`paymentsClient.js` and `complianceClient.js` both unwrap
`response.data.data` — Payments and Compliance (both Node) wrap every
response in `{ success, data }`; the Ledger (Go) does not. This was a
real bug caught during verification (a route silently returned `{}`
instead of account details) before the client's unwrap was fixed. Both
clients already handle this — but if you ever call the Ledger alongside
either Node service through the same helper, don't assume one shape
for both.
