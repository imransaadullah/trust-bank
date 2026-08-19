// Rule-based transaction monitoring and sanctions screening — not a
// trained model. COMPLIANCE_DESIGN_AND_BACKLOG.md's Segment A calls for
// starting rules-based and upgrading to model-based later "behind the
// same screenTransaction contract" — screenTransaction/screenSanctions
// are that contract. A future scored/ML implementation replaces the
// rule evaluation inside these functions; callers don't change.
//
// This is the service's first persisted state beyond policy data.
// decisionService.js's "stateless" claim is about decision *inputs* — no
// per-user history is queried here either, recentTransactions is still
// caller-supplied, same as every other decision. An audit trail of what
// got flagged (ComplianceCase) is a different, expected kind of state
// for a compliance system to hold, not a contradiction of that claim.
//
// screenTransaction flags but never blocks — a brand-new, untuned rules
// engine blocking real transactions would create false-positive
// friction with no track record to justify it. screenSanctions blocks —
// a sanctions-list match is a hard legal requirement, not a judgment
// call.
const prisma = require('../db/prismaClient');
const monitoringPolicyService = require('./monitoringPolicyService');
const { CaseNotFoundError } = require('../utils/errors');

async function screenTransaction({
  tenantId, jurisdiction = 'NG', userId, amount, counterpartyId,
  recentTransactions = [], transactionRef,
}) {
  const policy = await monitoringPolicyService.getCurrentMonitoringPolicy(tenantId, jurisdiction);

  // The caller (trustpay-backend) doesn't need to know the currently
  // configured window — it can always pass a generous fixed lookback and
  // let the policy define how much of it matters, preserving "the caller
  // doesn't need to redeploy when the rule changes."
  const windowStart = new Date(Date.now() - policy.velocityWindowHours * 3_600_000);
  const inWindow = recentTransactions.filter((t) => new Date(t.createdAt) >= windowStart);

  const matchedRules = [];

  const txnCount = inWindow.length + 1;
  if (txnCount > policy.velocityMaxTransactionCount) {
    matchedRules.push({ rule: 'velocity_count', count: txnCount, limit: policy.velocityMaxTransactionCount });
  }

  const distinctCounterparties = new Set(inWindow.map((t) => t.counterpartyId).filter(Boolean));
  if (counterpartyId) distinctCounterparties.add(counterpartyId);
  if (distinctCounterparties.size > policy.velocityMaxDistinctCounterparties) {
    matchedRules.push({
      rule: 'distinct_counterparties', count: distinctCounterparties.size,
      limit: policy.velocityMaxDistinctCounterparties,
    });
  }

  // Structuring: repeated transactions just under a reporting threshold —
  // the classic smurfing signal. "Near" means within 80% of the
  // threshold, not just an exact match.
  const nearThreshold = (amt) => amt >= policy.structuringThresholdKobo * 0.8 && amt <= policy.structuringThresholdKobo;
  const structuringCount = inWindow.filter((t) => nearThreshold(t.amount)).length + (nearThreshold(amount) ? 1 : 0);
  if (structuringCount >= policy.structuringWindowCount) {
    matchedRules.push({
      rule: 'structuring', count: structuringCount, limit: policy.structuringWindowCount,
      thresholdKobo: policy.structuringThresholdKobo,
    });
  }

  if (amount > policy.largeSingleTxnThresholdKobo) {
    matchedRules.push({ rule: 'large_single_txn', amount, thresholdKobo: policy.largeSingleTxnThresholdKobo });
  }

  const flagged = matchedRules.length > 0;
  const riskLevel = !flagged ? 'low' : matchedRules.length >= 2 ? 'high' : 'medium';

  if (flagged) {
    await prisma.complianceCase.create({
      data: {
        tenantId, userId, caseType: 'transaction_monitoring', severity: riskLevel,
        matchedRules, context: { amount, counterpartyId, transactionRef },
      },
    });
  }

  return { flagged, riskLevel, matchedRules, policyVersion: policy.version };
}

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Small local edit-distance implementation — deliberately not a
// dependency, this doesn't need to be more than a tolerance check for
// minor spelling variation against a handful of watchlist entries.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

const FUZZY_MATCH_MAX_DISTANCE = 2;

async function screenSanctions({ tenantId, userId, fullName }) {
  const normalized = normalizeName(fullName);
  if (!normalized) return { hit: false, matchedEntries: [] };

  // Loads the whole table per call — fine for the seed-scale dataset
  // this pass ships with; a real feed-scale watchlist would need a
  // trigram index or an external screening service, not this.
  const entries = await prisma.sanctionsWatchlistEntry.findMany();
  const matchedEntries = [];

  for (const entry of entries) {
    const candidates = [entry.fullName, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeName(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedCandidate === normalized || levenshtein(normalizedCandidate, normalized) <= FUZZY_MATCH_MAX_DISTANCE) {
        matchedEntries.push({ id: entry.id, fullName: entry.fullName, listSource: entry.listSource });
        break;
      }
    }
  }

  const hit = matchedEntries.length > 0;
  if (hit) {
    await prisma.complianceCase.create({
      data: {
        tenantId, userId, caseType: 'sanctions_hit', severity: 'blocking',
        matchedRules: matchedEntries, context: { fullName },
      },
    });
  }

  return { hit, matchedEntries };
}

const DELINQUENCY_SEVERITY = { '1-30': 'low', '31-60': 'medium', '61-90': 'high', '90+': 'blocking' };

// Unlike screenTransaction/screenSanctions (one real event -> one case),
// this is re-evaluated on every delinquencyRunner tick for the same loan —
// so it updates the existing open case in place instead of creating a
// duplicate every tick. A deliberate deviation from the create-only
// pattern above, not an oversight.
async function flagLoanDelinquency({ tenantId, userId, loanAccountId, daysPastDue, bucket, principalOutstandingKobo }) {
  const existing = await prisma.complianceCase.findFirst({
    where: { tenantId, caseType: 'loan_delinquency', status: 'open', context: { path: ['loanAccountId'], equals: loanAccountId } },
  });

  if (daysPastDue <= 0) {
    return { flagged: false, caseId: existing ? existing.id : null };
  }

  const severity = DELINQUENCY_SEVERITY[bucket] || 'low';
  const context = { loanAccountId, daysPastDue, bucket, principalOutstandingKobo };
  const matchedRules = [{ rule: 'days_past_due', daysPastDue, bucket }];

  if (existing) {
    const updated = await prisma.complianceCase.update({
      where: { id: existing.id },
      data: { severity, context, matchedRules },
    });
    return { flagged: true, caseId: updated.id };
  }

  const created = await prisma.complianceCase.create({
    data: { tenantId, userId, caseType: 'loan_delinquency', severity, matchedRules, context },
  });
  return { flagged: true, caseId: created.id };
}

async function listCases({ tenantId, status, caseType }) {
  return prisma.complianceCase.findMany({
    where: { tenantId, ...(status ? { status } : {}), ...(caseType ? { caseType } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

async function reviewCase({ tenantId, caseId, status, reviewedBy, reviewNotes }) {
  const existing = await prisma.complianceCase.findFirst({ where: { id: caseId, tenantId } });
  if (!existing) throw new CaseNotFoundError(caseId);
  return prisma.complianceCase.update({
    where: { id: caseId },
    data: { status, reviewedBy, reviewNotes, reviewedAt: new Date() },
  });
}

module.exports = { screenTransaction, screenSanctions, flagLoanDelinquency, listCases, reviewCase };
