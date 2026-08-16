// Postgres-backed, fixed 1-minute windows — see the schema comment on
// RateLimitCounter for why this isn't Redis. One atomic upsert-increment
// per request, safe under concurrent requests without an app-level lock:
// gen_random_uuid() is core Postgres (13+), already relied on elsewhere
// in this platform (services/ledger's own migrations use it).
const prisma = require('../db/prismaClient');

function currentWindowStart() {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
}

/** @returns {Promise<number>} the request count for the current window, after incrementing */
async function incrementAndGetCount(apiKeyId) {
  const windowStart = currentWindowStart();
  const result = await prisma.$queryRaw`
    INSERT INTO rate_limit_counters (id, api_key_id, window_start, request_count)
    VALUES (gen_random_uuid(), ${apiKeyId}::text, ${windowStart}, 1)
    ON CONFLICT (api_key_id, window_start)
    DO UPDATE SET request_count = rate_limit_counters.request_count + 1
    RETURNING request_count;
  `;
  return Number(result[0].request_count);
}

/** Seconds remaining until the current 1-minute window resets. */
function secondsUntilWindowReset() {
  return 60 - new Date().getSeconds();
}

module.exports = { incrementAndGetCount, secondsUntilWindowReset };
