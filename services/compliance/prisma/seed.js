// Seeds a handful of clearly-synthetic sanctions-watchlist entries for
// local development/testing. This is NOT a live OFAC/UN/EU feed — real
// feed ingestion (fetch, parse, diff, re-import on a schedule) is
// separate, undone work. Never seed real sanctioned-person data here.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SEED_BATCH_ID = 'seed-synthetic-v1';

const entries = [
  { fullName: 'Test Sanctioned Person One', aliases: ['TSP One', 'T. S. Person'] },
  { fullName: 'Test Sanctioned Person Two', aliases: [] },
];

async function main() {
  for (const entry of entries) {
    const exists = await prisma.sanctionsWatchlistEntry.findFirst({
      where: { fullName: entry.fullName, importBatchId: SEED_BATCH_ID },
    });
    if (exists) continue;
    await prisma.sanctionsWatchlistEntry.create({
      data: {
        listSource: 'SEED_TEST_DATA', fullName: entry.fullName, aliases: entry.aliases,
        importBatchId: SEED_BATCH_ID,
      },
    });
  }
  console.log(`Seeded ${entries.length} synthetic sanctions-watchlist entries (batch ${SEED_BATCH_ID}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
