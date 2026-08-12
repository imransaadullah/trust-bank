const { randomUUID } = require('crypto');

let prisma;
let monitoringPolicyService;
let screeningService;

beforeAll(() => {
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  monitoringPolicyService = require('../src/services/monitoringPolicyService');
  screeningService = require('../src/services/screeningService');
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

const maybeDescribe = process.env.DATABASE_URL ? describe : describe.skip;

// Loose limits — only the rule under test is meant to fire per policy.
async function seedLoosePolicy(tenantId, overrides = {}) {
  return monitoringPolicyService.publishMonitoringPolicy({
    tenantId, jurisdiction: 'NG',
    velocityWindowHours: 24,
    velocityMaxTransactionCount: 10,
    velocityMaxDistinctCounterparties: 10,
    structuringThresholdKobo: 500_000_00,
    structuringWindowCount: 3,
    largeSingleTxnThresholdKobo: 5_000_000_00,
    effectiveFrom: new Date(Date.now() - 1000),
    ...overrides,
  });
}

maybeDescribe('screeningService.screenTransaction', () => {
  test('does not flag a transaction within all limits', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId);
    const decision = await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 5_000_00,
      counterpartyId: 'cp-1', recentTransactions: [],
    });
    expect(decision.flagged).toBe(false);
    expect(decision.riskLevel).toBe('low');
    expect(decision.matchedRules).toHaveLength(0);
  });

  test('flags velocity_count when transaction count exceeds the limit', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId, { velocityMaxTransactionCount: 3 });
    const now = Date.now();
    const recentTransactions = [
      { amount: 5_000_00, counterpartyId: 'cp-same', createdAt: new Date(now - 1_000) },
      { amount: 5_000_00, counterpartyId: 'cp-same', createdAt: new Date(now - 2_000) },
      { amount: 5_000_00, counterpartyId: 'cp-same', createdAt: new Date(now - 3_000) },
    ];
    const decision = await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 5_000_00,
      counterpartyId: 'cp-same', recentTransactions,
    });
    expect(decision.flagged).toBe(true);
    expect(decision.matchedRules).toHaveLength(1);
    expect(decision.matchedRules[0].rule).toBe('velocity_count');
  });

  test('flags distinct_counterparties when distinct recipients exceed the limit', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId, { velocityMaxDistinctCounterparties: 3 });
    const now = Date.now();
    const recentTransactions = [
      { amount: 5_000_00, counterpartyId: 'cp-1', createdAt: new Date(now - 1_000) },
      { amount: 5_000_00, counterpartyId: 'cp-2', createdAt: new Date(now - 2_000) },
      { amount: 5_000_00, counterpartyId: 'cp-3', createdAt: new Date(now - 3_000) },
    ];
    const decision = await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 5_000_00,
      counterpartyId: 'cp-4', recentTransactions,
    });
    expect(decision.flagged).toBe(true);
    expect(decision.matchedRules.map((r) => r.rule)).toContain('distinct_counterparties');
  });

  test('flags structuring on repeated near-threshold amounts', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId, { structuringThresholdKobo: 500_000_00, structuringWindowCount: 3 });
    const now = Date.now();
    const recentTransactions = [
      { amount: 450_000_00, counterpartyId: 'cp-1', createdAt: new Date(now - 1_000) },
      { amount: 480_000_00, counterpartyId: 'cp-2', createdAt: new Date(now - 2_000) },
    ];
    const decision = await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 460_000_00,
      counterpartyId: 'cp-3', recentTransactions,
    });
    expect(decision.flagged).toBe(true);
    expect(decision.matchedRules.map((r) => r.rule)).toContain('structuring');
  });

  test('flags large_single_txn when amount exceeds the threshold', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId, { largeSingleTxnThresholdKobo: 1_000_000_00 });
    const decision = await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 2_000_000_00,
      counterpartyId: 'cp-1', recentTransactions: [],
    });
    expect(decision.flagged).toBe(true);
    expect(decision.matchedRules).toHaveLength(1);
    expect(decision.matchedRules[0].rule).toBe('large_single_txn');
  });

  test('a flagged screen writes exactly one ComplianceCase, queryable via listCases', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedLoosePolicy(tenantId, { largeSingleTxnThresholdKobo: 1_000_000_00 });
    await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId, amount: 2_000_000_00,
      counterpartyId: 'cp-1', recentTransactions: [], transactionRef: 'TXN-1',
    });
    const cases = await screeningService.listCases({ tenantId });
    expect(cases).toHaveLength(1);
    expect(cases[0].caseType).toBe('transaction_monitoring');
    expect(cases[0].userId).toBe(userId);
  });

  test('an unflagged screen writes no ComplianceCase', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId);
    await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 5_000_00,
      counterpartyId: 'cp-1', recentTransactions: [],
    });
    const cases = await screeningService.listCases({ tenantId });
    expect(cases).toHaveLength(0);
  });
});

maybeDescribe('screeningService.screenSanctions', () => {
  async function seedWatchlistEntry(fullName, aliases = []) {
    return prisma.sanctionsWatchlistEntry.create({
      data: { listSource: 'TEST', fullName, aliases, importBatchId: randomUUID() },
    });
  }

  test('an exact name match returns hit:true and writes a blocking case', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedWatchlistEntry('Test Sanctioned Person');
    const decision = await screeningService.screenSanctions({
      tenantId, userId, fullName: 'Test Sanctioned Person',
    });
    expect(decision.hit).toBe(true);
    expect(decision.matchedEntries).toHaveLength(1);

    const cases = await screeningService.listCases({ tenantId });
    expect(cases).toHaveLength(1);
    expect(cases[0].caseType).toBe('sanctions_hit');
    expect(cases[0].severity).toBe('blocking');
  });

  test('a non-matching name returns hit:false and writes no case', async () => {
    const tenantId = randomUUID();
    await seedWatchlistEntry('Some Other Watchlisted Name');
    const decision = await screeningService.screenSanctions({
      tenantId, userId: randomUUID(), fullName: 'Completely Unrelated Person',
    });
    expect(decision.hit).toBe(false);
    const cases = await screeningService.listCases({ tenantId });
    expect(cases).toHaveLength(0);
  });

  test('matches against an alias, not just the primary name', async () => {
    const tenantId = randomUUID();
    await seedWatchlistEntry('Primary Legal Name', ['Known Alias Name']);
    const decision = await screeningService.screenSanctions({
      tenantId, userId: randomUUID(), fullName: 'Known Alias Name',
    });
    expect(decision.hit).toBe(true);
  });
});

maybeDescribe('screeningService.reviewCase', () => {
  test('updates status, reviewedBy, and reviewNotes', async () => {
    const tenantId = randomUUID();
    await seedLoosePolicy(tenantId, { largeSingleTxnThresholdKobo: 1_000_000_00 });
    await screeningService.screenTransaction({
      tenantId, jurisdiction: 'NG', userId: randomUUID(), amount: 2_000_000_00,
      counterpartyId: 'cp-1', recentTransactions: [],
    });
    const [openCase] = await screeningService.listCases({ tenantId });
    const reviewed = await screeningService.reviewCase({
      tenantId, caseId: openCase.id, status: 'dismissed', reviewedBy: 'ops@trustpay.example',
      reviewNotes: 'False positive — known recurring merchant payment.',
    });
    expect(reviewed.status).toBe('dismissed');
    expect(reviewed.reviewedBy).toBe('ops@trustpay.example');
    expect(reviewed.reviewedAt).not.toBeNull();
  });

  test('throws CaseNotFoundError for an unknown case id', async () => {
    const tenantId = randomUUID();
    await expect(
      screeningService.reviewCase({ tenantId, caseId: randomUUID(), status: 'dismissed' }),
    ).rejects.toThrow(/No compliance case found/);
  });
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping screeningService integration tests', () => {});
}
