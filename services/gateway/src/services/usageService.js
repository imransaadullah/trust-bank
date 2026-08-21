// Reads back what usageRollupService writes (ApiKeyDailyUsage), plus
// today's still-live RateLimitCounter rows — today only ever rolls up
// on the *next* usageRollupRunner tick, so merging it in directly means
// a tenant querying "today" isn't a blind spot until then. Usage counts
// only, no cost/quota/plan computation — see ApiKeyDailyUsage's own
// schema comment for why (Anchor-informed: transparency, not billing).
const prisma = require('../db/prismaClient');

function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function parseDateParam(value, fallback) {
  if (!value) return fallback;
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * @param {{ tenantId: string, from?: string, to?: string }} opts — from/to as YYYY-MM-DD, inclusive
 */
async function getUsage({ tenantId, from, to }) {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultFrom = new Date(todayStart);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);

  const fromDate = parseDateParam(from, defaultFrom);
  const toDate = parseDateParam(to, todayStart);
  const toDateExclusive = new Date(toDate);
  toDateExclusive.setUTCDate(toDateExclusive.getUTCDate() + 1);

  const keys = await prisma.apiKey.findMany({ where: { tenantId }, select: { id: true, label: true, tier: true } });
  const keysById = new Map(keys.map((k) => [k.id, k]));

  const historicalRows = await prisma.apiKeyDailyUsage.findMany({
    where: { tenantId, date: { gte: fromDate, lt: toDateExclusive } },
    select: { apiKeyId: true, date: true, requestCount: true },
  });

  const dailyByKey = new Map();
  for (const row of historicalRows) {
    if (!dailyByKey.has(row.apiKeyId)) dailyByKey.set(row.apiKeyId, new Map());
    dailyByKey.get(row.apiKeyId).set(toDateOnly(row.date), row.requestCount);
  }

  if (todayStart >= fromDate && todayStart < toDateExclusive && keys.length > 0) {
    const liveRows = await prisma.rateLimitCounter.groupBy({
      by: ['apiKeyId'],
      where: { apiKeyId: { in: keys.map((k) => k.id) }, windowStart: { gte: todayStart } },
      _sum: { requestCount: true },
    });
    for (const row of liveRows) {
      const count = row._sum.requestCount || 0;
      if (count === 0) continue;
      if (!dailyByKey.has(row.apiKeyId)) dailyByKey.set(row.apiKeyId, new Map());
      dailyByKey.get(row.apiKeyId).set(toDateOnly(todayStart), count);
    }
  }

  const keysOut = [];
  for (const [apiKeyId, daily] of dailyByKey.entries()) {
    const key = keysById.get(apiKeyId);
    if (!key) continue;
    const dailyArr = Array.from(daily.entries())
      .map(([date, requestCount]) => ({ date, requestCount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const totalRequests = dailyArr.reduce((sum, d) => sum + d.requestCount, 0);
    keysOut.push({ apiKeyId, label: key.label, tier: key.tier, totalRequests, daily: dailyArr });
  }
  keysOut.sort((a, b) => b.totalRequests - a.totalRequests);

  return { from: toDateOnly(fromDate), to: toDateOnly(toDate), keys: keysOut };
}

module.exports = { getUsage };
