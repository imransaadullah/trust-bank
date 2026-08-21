// Aggregates every past day's RateLimitCounter rows into one row per
// (apiKeyId, date) in ApiKeyDailyUsage, then deletes the raw rows it
// just summed — closing RateLimitCounter's own unbounded-growth gap
// (nothing else prunes it) as a side effect of building the read model
// a usage-transparency dashboard actually needs. Only ever touches
// *past* days; today's live per-minute counters are untouched, since
// the rate limiter itself still reads the current-minute row directly.
const prisma = require('../db/prismaClient');

/**
 * @returns {Promise<{ upsertedRows: number, deletedRows: number }>}
 */
async function rollupAndPrune() {
  return prisma.$transaction(async (tx) => {
    const upserted = await tx.$executeRaw`
      INSERT INTO api_key_daily_usage (id, api_key_id, tenant_id, date, request_count)
      SELECT gen_random_uuid(), rlc.api_key_id, ak.tenant_id, date_trunc('day', rlc.window_start), SUM(rlc.request_count)
      FROM rate_limit_counters rlc
      JOIN api_keys ak ON ak.id = rlc.api_key_id
      WHERE rlc.window_start < date_trunc('day', now())
      GROUP BY rlc.api_key_id, ak.tenant_id, date_trunc('day', rlc.window_start)
      ON CONFLICT (api_key_id, date)
      DO UPDATE SET request_count = api_key_daily_usage.request_count + EXCLUDED.request_count;
    `;
    const deleted = await tx.$executeRaw`
      DELETE FROM rate_limit_counters WHERE window_start < date_trunc('day', now());
    `;
    return { upsertedRows: upserted, deletedRows: deleted };
  });
}

module.exports = { rollupAndPrune };
