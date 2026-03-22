#!/usr/bin/env node

/**
 * Import eBay listings into Shopify as Card Yeti products.
 *
 * Fetches item details from eBay Browse API, extracts card-specific data
 * from item specifics, and creates products via the Shopify productSet API
 * with all appropriate metafields, collections, and template assignments.
 *
 * Usage:
 *   node reference/import-from-ebay.js <item-id> [item-id...] [options]
 *   npm run import-ebay -- <item-id> [options]
 *
 * Options:
 *   --dry-run           Preview without making Shopify API calls
 *   --status <status>   Product status: active (default) or draft
 *   --no-new-arrivals   Skip new-arrival tag rotation
 */

import { getItem } from './helpers/ebay-client.js';
import { shopifyGraphQL } from './helpers/shopify-client.js';
import { parseGraderFromTitle } from './helpers/csv-transforms.js';
import {
  sleep,
  DELAY_MS,
  removeNewArrivalTags,
  fetchStoreData,
  uploadCard,
} from './helpers/product-builder.js';

// ── Config ──────────────────────────────────────────────────────────────────

// Known item specific names from eBay Pokémon card listings
const ITEM_SPECIFIC_KEYS = {
  pokemon: ['Pokémon Character', 'Character', 'Pokemon Character', 'Pokemon'],
  setName: ['Set', 'Card Set'],
  number: ['Card Number', 'Card #'],
  grader: ['Professional Grader', 'Grading Company', 'Grader'],
  grade: ['Grade', 'Card Grade'],
  certNumber: ['Certification Number', 'Cert Number', 'Cert #'],
  language: ['Language'],
  year: ['Year Manufactured', 'Year'],
  rarity: ['Rarity'],
  condition: ['Card Condition', 'Condition'],
};

// Search for existing product by eBay item ID metafield to prevent duplicate imports
const PRODUCT_BY_EBAY_ID_QUERY = `
  query productsByEbayId($query: String!) {
    products(first: 1, query: $query) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a named value from eBay item specifics (localizedAspects).
 * Tries multiple known key names for each field.
 */
function getItemSpecific(aspects, keys) {
  if (!aspects) return null;
  for (const key of keys) {
    const match = aspects.find(
      (a) => a.name.toLowerCase() === key.toLowerCase()
    );
    if (match) return match.value;
  }
  return null;
}

/**
 * Extract card data from an eBay item response.
 */
function extractCardData(item) {
  const aspects = item.localizedAspects || [];
  const title = item.title || '';

  // Get grading info — prefer item specifics, fall back to title parsing
  const specificGrader = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.grader);
  const specificGrade = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.grade);
  const titleInfo = parseGraderFromTitle(title);

  const grader = specificGrader || titleInfo.grader;
  const grade = specificGrade || titleInfo.grade;
  const isGraded = !!(grader && grade);

  const pokemon = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.pokemon) || '';
  const setName = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.setName) || '';
  const number = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.number) || '';
  const certNumber = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.certNumber) || '';
  const language = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.language) || 'English';
  const year = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.year) || '';
  const rarity = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.rarity) || '';
  const condition = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.condition) || '';

  // Price
  const ebayPrice = parseFloat(item.price?.value || '0');

  // Images
  const imageUrls = [];
  if (item.image?.imageUrl) {
    imageUrls.push(item.image.imageUrl.replace(/s-l\d+/, 's-l1600'));
  }
  if (item.additionalImages) {
    for (const img of item.additionalImages) {
      if (img.imageUrl) {
        imageUrls.push(img.imageUrl.replace(/s-l\d+/, 's-l1600'));
      }
    }
  }

  // Description (HTML)
  const description = item.description || '';

  return {
    title,
    pokemon,
    setName,
    number,
    grader: grader ? grader.toUpperCase() : null,
    grade,
    isGraded,
    certNumber,
    language,
    year,
    rarity,
    condition,
    ebayPrice,
    imageUrls,
    description,
    isJapanese: /japanese/i.test(language),
    ebayItemId: item.legacyItemId || item.itemId || '',
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const dryRun = args.includes('--dry-run');
  const rotateNewArrivals = !args.includes('--no-new-arrivals');
  let status = 'active';
  const statusIdx = args.indexOf('--status');
  if (statusIdx !== -1 && args[statusIdx + 1]) {
    status = args[statusIdx + 1].toLowerCase();
    if (!['active', 'draft'].includes(status)) {
      console.error('ERROR  --status must be "active" or "draft"');
      process.exit(1);
    }
  }

  // Collect item IDs (args that aren't flags)
  const flagArgs = new Set(['--dry-run', '--status', '--no-new-arrivals']);
  const itemIds = args.filter((a, i) => {
    if (flagArgs.has(a)) return false;
    if (i > 0 && args[i - 1] === '--status') return false;
    return true;
  });

  if (itemIds.length === 0) {
    console.error('Usage: node reference/import-from-ebay.js <item-id> [item-id...] [--dry-run] [--status draft|active] [--no-new-arrivals]');
    console.error('\nExamples:');
    console.error('  node reference/import-from-ebay.js 325678901234');
    console.error('  node reference/import-from-ebay.js 325678901234 325678905678 --dry-run');
    console.error('  npm run import-ebay -- 325678901234 --status draft');
    process.exit(1);
  }

  console.log(`\nImporting ${itemIds.length} item(s) from eBay...`);
  console.log(`  Status:   ${status}`);
  console.log(`  Dry run:  ${dryRun}\n`);

  // Fetch eBay items
  console.log('Fetching items from eBay...');
  const cards = [];

  for (const itemId of itemIds) {
    try {
      const item = await getItem(itemId);
      const card = extractCardData(item);
      cards.push(card);

      const typeStr = card.isGraded ? `${card.grader} ${card.grade}` : 'Raw';
      console.log(`  OK    ${card.title.substring(0, 60).padEnd(60)}  ${typeStr.padEnd(10)}  $${card.ebayPrice.toFixed(2)}  ${card.imageUrls.length} imgs`);
    } catch (err) {
      console.log(`  FAIL  Item ${itemId}: ${err.message.substring(0, 120)}`);
    }
  }

  if (cards.length === 0) {
    console.error('\nNo items fetched. Exiting.');
    process.exit(1);
  }

  console.log(`\nFetched ${cards.length} item(s) from eBay.\n`);

  // Fetch Shopify store data
  let collectionMap = {};
  let locationId = null;
  let publicationInputs = [];

  if (!dryRun) {
    const storeData = await fetchStoreData();
    collectionMap = storeData.collectionMap;
    locationId = storeData.locationId;
    publicationInputs = storeData.publicationInputs;
  }

  // Rotate new-arrival tags
  if (rotateNewArrivals) {
    if (dryRun) {
      console.log('  [dry-run] Would remove new-arrival tag from all existing products');
      console.log('  [dry-run] New imports would receive the new-arrival tag\n');
    } else {
      console.log('Rotating new-arrival tags...');
      await removeNewArrivalTags();
    }
  }

  // Upload each card to Shopify
  let created = 0;
  let failed = 0;
  let skipped = 0;

  for (const card of cards) {
    // Dedup: check if a product with this eBay item ID already exists
    if (!dryRun && card.ebayItemId) {
      try {
        const dupCheck = await shopifyGraphQL(PRODUCT_BY_EBAY_ID_QUERY, {
          query: `metafields.card.ebay_item_id:"${card.ebayItemId}"`,
        });
        if (dupCheck.products.edges.length > 0) {
          const existing = dupCheck.products.edges[0].node;
          const title = card.title.substring(0, 50).padEnd(50);
          console.log(`  SKIP  ${title}  already imported (${existing.id})`);
          skipped++;
          continue;
        }
      } catch (err) {
        console.warn(`  WARN  Dedup check failed for item ${card.ebayItemId}: ${err.message}`);
      }
    }

    const result = await uploadCard(card, {
      collectionMap, locationId, publicationInputs, status, dryRun, rotateNewArrivals,
    });

    if (result === 'created') created++;
    else if (result === 'failed') failed++;

    if (!dryRun) await sleep(DELAY_MS);
  }

  // Summary
  console.log(`\n${dryRun ? 'Dry run complete' : 'Done'}.`);
  console.log(`  ${dryRun ? 'Would create' : 'Created'}: ${created}`);
  if (skipped > 0) console.log(`  Skipped: ${skipped} (already imported)`);
  if (failed > 0) console.log(`  Failed:  ${failed}`);
  console.log(`  Source:  eBay (${itemIds.length} item IDs)`);
}

main().catch((err) => {
  console.error(`\nFATAL  ${err.message}`);
  process.exit(1);
});
