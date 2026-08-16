// Real sanctions-list ingestion, replacing the seed/test data
// SanctionsWatchlistEntry shipped with. Three independent sources — one
// failing (a government site changing markup, a feed timing out) never
// blocks the other two. Each source's rows are replaced wholesale on
// every run (delete all rows for that listSource, insert the fresh set,
// in one transaction) rather than diffed/upserted — simpler, and
// correctly drops delisted entries instead of letting them linger
// forever. importBatchId ties every row from one run together for
// traceability, same field the seed script already used.
const axios = require('axios');
const { parse: parseCsv } = require('csv-parse/sync');
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');
const { randomUUID } = require('crypto');
const prisma = require('../db/prismaClient');
const logger = require('../utils/logger');

// OFAC's export endpoint is genuinely slow — ~14s for a single ~5.6MB
// file measured live during this feature's own verification, and
// ingestOfacSdn fetches two such files concurrently. 90s leaves real
// headroom rather than tuning to the exact number observed once.
const HTTP_TIMEOUT_MS = 90_000;
const USER_AGENT = 'trust-bank-compliance-sanctions-feed/1.0';

async function fetchText(url) {
  const res = await axios.get(url, { timeout: HTTP_TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT } });
  return res.data;
}

/** OFAC blanks every empty field as the literal string "-0-", not "". */
function ofacValue(v) {
  const trimmed = (v || '').trim();
  return trimmed === '-0-' || trimmed === '' ? null : trimmed;
}

async function replaceListSource(listSource, rows) {
  const importBatchId = randomUUID();
  await prisma.$transaction([
    prisma.sanctionsWatchlistEntry.deleteMany({ where: { listSource } }),
    prisma.sanctionsWatchlistEntry.createMany({
      data: rows.map((r) => ({ ...r, listSource, importBatchId })),
    }),
  ]);
  return { listSource, count: rows.length, importBatchId };
}

// --- OFAC SDN list --------------------------------------------------------
// sanctionslistservice.ofac.treas.gov — free, no auth, no rate limit
// published. SDN.CSV has no header row; documented column order is
// ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type,
// Tonnage, GRT, Vess_flag, Vess_owner, Remarks. ALT.CSV (aliases) is
// ent_num, alt_num, alt_type, alt_name, remarks, joined on ent_num.
const OFAC_SDN_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV';
const OFAC_ALT_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV';

async function ingestOfacSdn() {
  const [sdnCsv, altCsv] = await Promise.all([fetchText(OFAC_SDN_URL), fetchText(OFAC_ALT_URL)]);

  const sdnRows = parseCsv(sdnCsv, { columns: false, relax_column_count: true, skip_empty_lines: true });
  const altRows = parseCsv(altCsv, { columns: false, relax_column_count: true, skip_empty_lines: true });

  const aliasesByEntNum = new Map();
  for (const row of altRows) {
    const entNum = row[0];
    const aliasName = ofacValue(row[3]);
    if (!entNum || !aliasName) continue;
    if (!aliasesByEntNum.has(entNum)) aliasesByEntNum.set(entNum, []);
    aliasesByEntNum.get(entNum).push(aliasName);
  }

  const rows = [];
  for (const row of sdnRows) {
    const entNum = row[0];
    const fullName = ofacValue(row[1]);
    if (!entNum || !fullName) continue;
    rows.push({ fullName, aliases: aliasesByEntNum.get(entNum) || [], dateOfBirth: null });
  }

  return replaceListSource('OFAC_SDN', rows);
}

// --- UN Security Council Consolidated List --------------------------------
// scsanctions.un.org — free, no auth. INDIVIDUAL/ENTITY nodes; a single
// entry parses as an object, multiple as an array (fast-xml-parser's
// default behavior) — always normalize to an array before iterating.
const UN_CONSOLIDATED_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function unAliasNames(individualOrEntity) {
  const aliasField = individualOrEntity.INDIVIDUAL_ALIAS ?? individualOrEntity.ENTITY_ALIAS;
  return asArray(aliasField)
    .map((a) => (a && typeof a === 'object' ? a.ALIAS_NAME : a))
    .filter((name) => typeof name === 'string' && name.trim().length > 0);
}

function unDateOfBirth(individual) {
  try {
    const dob = asArray(individual.INDIVIDUAL_DATE_OF_BIRTH)[0];
    const dateStr = dob && (dob.DATE || dob.YEAR);
    if (!dateStr) return null;
    const parsed = new Date(/^\d{4}$/.test(String(dateStr)) ? `${dateStr}-01-01` : dateStr);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    // Malformed date on one entry shouldn't fail the whole ingestion.
    return null;
  }
}

async function ingestUnConsolidated() {
  const xml = await fetchText(UN_CONSOLIDATED_URL);
  const parser = new XMLParser({ ignoreAttributes: true });
  const doc = parser.parse(xml);
  const list = doc.CONSOLIDATED_LIST || {};

  const rows = [];

  for (const ind of asArray(list.INDIVIDUALS?.INDIVIDUAL)) {
    const fullName = [ind.FIRST_NAME, ind.SECOND_NAME, ind.THIRD_NAME, ind.FOURTH_NAME]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' ');
    if (!fullName) continue;
    rows.push({ fullName, aliases: unAliasNames(ind), dateOfBirth: unDateOfBirth(ind) });
  }

  for (const ent of asArray(list.ENTITIES?.ENTITY)) {
    const fullName = typeof ent.FIRST_NAME === 'string' ? ent.FIRST_NAME.trim() : '';
    if (!fullName) continue;
    rows.push({ fullName, aliases: unAliasNames(ent), dateOfBirth: null });
  }

  return replaceListSource('UN_CONSOLIDATED', rows);
}

// --- Nigeria Sanctions Committee -------------------------------------------
// nigsac.gov.ng — no API, no CSV/XML export; a genuine HTML table, but a
// government webpage with no stability contract, unlike the two purpose-
// built exports above. Two tables on one page, distinguished by header
// text ("Full Name" for individuals, "Entity Name" for entities) rather
// than position, since page layout could reorder them without warning.
const NG_SANCTIONS_URL = 'https://nigsac.gov.ng/IndSancList';

async function ingestNigeriaSanctionsCommittee() {
  const html = await fetchText(NG_SANCTIONS_URL);
  const $ = cheerio.load(html);

  const rows = [];
  $('table').each((_, table) => {
    const headers = $(table).find('thead th').map((__, th) => $(th).text().trim()).get();
    const nameColIndex = headers.findIndex((h) => h === 'Full Name' || h === 'Entity Name');
    if (nameColIndex === -1) return; // not a table we recognize — skip, don't guess

    $(table).find('tbody tr').each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get();
      const fullName = cells[nameColIndex];
      if (fullName) rows.push({ fullName, aliases: [], dateOfBirth: null });
    });
  });

  return replaceListSource('NG_SANCTIONS_COMMITTEE', rows);
}

// --- Orchestrator -----------------------------------------------------------
async function ingestAllFeeds() {
  const sources = [
    { name: 'OFAC_SDN', fn: ingestOfacSdn },
    { name: 'UN_CONSOLIDATED', fn: ingestUnConsolidated },
    { name: 'NG_SANCTIONS_COMMITTEE', fn: ingestNigeriaSanctionsCommittee },
  ];

  const results = [];
  for (const { name, fn } of sources) {
    try {
      const result = await fn();
      logger.info(`[SanctionsFeed] ${name}: ${result.count} entries ingested`);
      results.push({ source: name, success: true, count: result.count });
    } catch (err) {
      logger.error(`[SanctionsFeed] ${name} failed: ${err.message}`);
      results.push({ source: name, success: false, error: err.message });
    }
  }
  return results;
}

module.exports = { ingestOfacSdn, ingestUnConsolidated, ingestNigeriaSanctionsCommittee, ingestAllFeeds };
