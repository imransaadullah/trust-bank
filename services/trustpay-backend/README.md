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
- Binds `127.0.0.1` by default (`BIND_HOST`), never `0.0.0.0` — even
  though this is the public-facing service, a reverse proxy
  (`../../deploy/Caddyfile.example`) is meant to be the only process that
  binds a public interface. See `../../deploy/NETWORK_TOPOLOGY.md`.
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
- Transaction monitoring and sanctions screening, both wired into the
  same `enforceCompliance` helper: 4 real P2P transfers against a
  velocity policy capped at 3/24h all succeeded (monitoring never
  blocks) and the 4th produced a case on `services/compliance`'s side;
  a transfer from a user whose `displayName` matched a seeded sanctions
  entry was rejected with `COMPLIANCE_DENIED` before the Ledger was ever
  called — confirmed by checking the sender's balance was untouched
- `User.verifiedFullName` — populated from `services/payments`' BVN/NIN
  `verifyIdentity` call's `matchedName` at Tier-1 verification, screened
  instead of the self-reported `displayName` whenever it's set (falls
  back to `displayName` for a Tier-0 user who hasn't verified). Verified
  live against `services/compliance`'s real, currently-ingested OFAC/UN/
  Nigeria sanctions data (see that service's README) — a user whose
  verified name matched a real entry was blocked even though their
  display name didn't, and the real `/kyc/verify-identity` route was
  confirmed to persist the provider's own matched name, not the
  request's own `firstName`/`lastName`
- Savings, via the Ledger's `internal/wallet/savings.go` and
  `internal/accrual` directly (`/savings` here is a thin pass-through —
  see `services/ledger`'s README for what was verified live: open/fund,
  lock enforcement, matured withdrawal, and the background interest job)
- Every upstream call (Ledger, Payments, Compliance) now authenticates
  with a real scoped `operate` credential, not a shared secret — see
  `../../SERVICE_CREDENTIAL_MODEL.md`. Verified as part of the full
  4-service rebuild: every flow above still worked end-to-end with zero
  shared secrets anywhere in the stack.
- Bills (`/bills/pay`), through `enforceCompliance` — the same shared
  helper (`src/services/complianceEnforcement.js`, extracted out of
  `wallet.js` so both routes go through identical checks) `/wallet/
  withdraw` uses. Verified live: a Tier-0 user is blocked the same way a
  Tier-0 withdrawal is blocked; a Tier-1 user's payment debits the
  wallet, genuinely fails against fake Kuda credentials (a real 401 from
  Kuda's actual token endpoint), and the debit is confirmed reversed —
  the customer's balance restored exactly, the local `Transaction` row
  correctly `status: 'reversed'`. The existing withdrawal/P2P/savings
  flows were re-verified unchanged after `enforceCompliance` moved out
  of `wallet.js`.
- Identity is behind a provider abstraction (`src/identity/`), the same
  pattern `PaymentsProvider`/`BillsProvider` already use for rails and
  billers: a contract (`identityProvider.js`), a real implementation
  (`authCoreProvider.js`, consolidating the former `authCoreClient.js` +
  `authTokenVerifier.js` into one file), and an interface-only stub
  (`twilioVerifyProvider.js`) proving the contract isn't secretly
  AuthCore-shaped. `User.identityProviderUid` (renamed from the
  vendor-named `authCoreUid`) is the concept, not the vendor. AuthCore is
  the only real implementation — see "Not verified" below for what that
  means for Twilio Verify.

**Verified live end-to-end (as of the identity-provider refactor):**
`/auth/send-otp` and `/auth/verify-otp` through the real route, with only
`AuthCoreProvider.prototype.verifyOtp` patched to skip the outbound
network call this environment can't reach — everything downstream of
that boundary (user creation with `identityProviderUid`, Ledger
wallet-open, device create-or-touch, JWT mint) ran for real against a
live Ledger/Payments/Compliance stack: signup produced a Tier-0 wallet
(`walletReady: true`), a repeat login with the same device correctly
returned `isNewDevice: false`, a wrong code was correctly rejected before
ever reaching AuthCore, and a same-session `/savings` call reached the
Ledger for real and got back a genuine insufficient-balance error —
confirming `requireAuth` and the rest of the stack are unaffected by the
refactor.

**Not verified — needs live credentials this environment doesn't have:**
a real AuthCore OTP round trip itself (the boundary above is exactly
where that limitation now lives, replacing the old client-level one), a
real Twilio Verify call (interface-proven only, not built — no second
market exists yet to justify building it for real, same framing as
Merchant Checkout in `COMPLIANCE_DESIGN_AND_BACKLOG.md`), and a
*successful* KYC verify/DVA provisioning/payout/bill-purchase (their
failure paths were exercised for real instead — see `services/payments`'
README for what that proved).

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
              # already running; a tenant provisioned on all three with
              # operate-scope credentials issued for this backend (see
              # ../../SERVICE_CREDENTIAL_MODEL.md and each service's README);
              # and a KYC-tier + device-binding policy published on
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

curl -X POST localhost:8082/savings -H "Authorization: Bearer $TOKEN" \
  -d '{"annualRateBps":1200,"lockDays":30,"principalKobo":1000000}'
curl -X POST localhost:8082/savings/$SAVINGS_ACCOUNT_ID/withdraw -H "Authorization: Bearer $TOKEN" \
  -d '{"amount":50000}'
curl localhost:8082/savings -H "Authorization: Bearer $TOKEN"

curl localhost:8082/bills/billers?type=airtime -H "Authorization: Bearer $TOKEN"
curl -X POST localhost:8082/bills/verify -H "Authorization: Bearer $TOKEN" \
  -d '{"billerCode":"biller-1","customerId":"08010000000"}'
# requires kycTier >= 1, goes through enforceCompliance same as withdraw
curl -X POST localhost:8082/bills/pay -H "Authorization: Bearer $TOKEN" \
  -d '{"billerCode":"biller-1","customerId":"08010000000","amount":50000,"customerName":"Ada Lovelace"}'
```

## Layout

```
prisma/               User (identityProviderUid, not authCoreUid — see
                       src/identity/), Device, Transaction (local statement
                       cache — the Ledger has no list-entries endpoint yet;
                       metadata Json? holds bill_payment-specific fields
                       like billerCode)
src/identity/          identityProvider.js (contract), authCoreProvider.js
                       (real, consolidates the old authCoreClient +
                       authTokenVerifier, JWKS-only), twilioVerifyProvider.js
                       (interface-only stub), registry.js (name -> instance,
                       a single deploy-time IDENTITY_PROVIDER choice)
src/services/          ledgerClient, paymentsClient, complianceClient,
                       complianceEnforcement (enforceCompliance, shared by
                       wallet.js and bills.js)
src/routes/            auth, kyc, wallet, savings, bills
src/middleware/auth.js  verifies this backend's own JWT (not AuthCore's, not
                       the Ledger's/Payments'/Compliance's operate credentials)
                       and attaches the device claim minted at login
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
