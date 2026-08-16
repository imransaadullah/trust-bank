// Manually triggers a sanctions-feed refresh — run directly on the box,
// same "no tenant-scoped credential gates this" reasoning as
// bootstrapKey.js being a local script rather than an HTTP route: the
// watchlist is platform-wide (SanctionsWatchlistEntry has no tenantId),
// so there's no natural tenant admin credential that should be able to
// trigger a refresh of everyone's data.
//
//   node scripts/refreshSanctionsFeed.js
const prisma = require('../src/db/prismaClient');
const { ingestAllFeeds } = require('../src/services/sanctionsFeedService');

async function main() {
  const results = await ingestAllFeeds();
  for (const r of results) {
    if (r.success) {
      console.log(`${r.source}: ${r.count} entries ingested`);
    } else {
      console.error(`${r.source}: FAILED — ${r.error}`);
    }
  }
  if (results.some((r) => !r.success)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
