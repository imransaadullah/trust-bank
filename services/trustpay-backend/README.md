# TrustPay Backend

The product/KYC/UX layer for TrustPay — an OPay-like wallet, the first
real tenant on trust-bank. Owns customer identity and KYC gating; never
touches a provider SDK or a NUBAN algorithm directly. Everything
money-adjacent goes through two other services:

- **`services/ledger`** (Go) — balance, P2P, deposit/withdrawal recording
- **`services/payments`** (Node) — account provisioning, BVN/NIN checks, payouts

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

## Setup

```bash
createdb trustpay_backend
cp .env.example .env   # then edit it

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustpay_backend
npx prisma migrate deploy

npm install
npm run dev   # :8082, requires the Ledger and Payments services already running,
              # and a tenant already provisioned on both (see their READMEs)
```

## API

```bash
curl -X POST localhost:8082/auth/send-otp -d '{"phone":"+2348010000000"}'
curl -X POST localhost:8082/auth/verify-otp -d '{"phone":"+2348010000000","code":"123456"}'
# -> { token, user: { id, phoneNumber, kycTier, walletReady } }

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
prisma/               User, Transaction (local statement cache — the Ledger
                       has no list-entries endpoint yet)
src/services/          authCoreClient, authTokenVerifier (lifted from
                       truechat/backend, JWKS-only), ledgerClient, paymentsClient
src/routes/            auth, kyc, wallet
src/middleware/auth.js  verifies this backend's own JWT (not AuthCore's, not
                       the Ledger's/Payments' shared secrets)
```

## A bug worth knowing about if you're extending this

`paymentsClient.js` unwraps `response.data.data` — Payments (Node) wraps
every response in `{ success, data }`; the Ledger (Go) does not. This was
a real bug caught during verification (a route silently returned `{}`
instead of account details) before the client's unwrap was fixed. If you
add a new Payments endpoint, the client already handles this — but if you
ever call the Ledger and Payments through the same helper, don't assume
one shape for both.
