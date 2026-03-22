#!/usr/bin/env node

/**
 * Exports active Shopify products to a Whatnot-compatible CSV for BIN listings.
 *
 * Usage:
 *   node reference/export-whatnot.js [options]
 *
 * Options:
 *   --collection <handle>     Filter by collection (e.g., graded-cards)
 *   --price-min <amount>      Minimum price filter
 *   --price-max <amount>      Maximum price filter
 *   --shipping-profile <val>  Override auto-detected shipping profile
 *   --output <filename>       Custom output filename
 *   --dry-run                 Preview without writing CSV
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { shopifyGraphQL } from './helpers/shopify-client.js';
import { toCSV } from './helpers/csv-transforms.js';
import {
  WHATNOT_HEADERS,
  mapToWhatnotRow,
} from './helpers/whatnot-columns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── GraphQL ─────────────────────────────────────────────────────────────────

const COLLECTIONS_QUERY = `
  {
    collections(first: 250) {
      edges {
        node {
          id
          handle
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  query products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          productType
          templateSuffix
          tags
          variants(first: 5) {
            edges {
              node {
                price
                compareAtPrice
                sku
                inventoryQuantity
              }
            }
          }
          images(first: 10) {
            edges {
              node {
                url
                altText
              }
            }
          }
          metafields(first: 20) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `
  query collectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            handle
            description
            productType
            templateSuffix
            tags
            variants(first: 5) {
              edges {
                node {
                  price
                  sku
                  inventoryQuantity
                }
              }
            }
            images(first: 10) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
            metafields(first: 20) {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse card namespace metafields from GraphQL edges into a key-value map.
 */
function parseMetafields(metafieldEdges) {
  const map = {};
  for (const edge of metafieldEdges) {
    if (edge.node.namespace === 'card') {
      map[edge.node.key] = edge.node.value;
    }
  }
  return map;
}

/**
 * Fetch all products matching query, paginating with cursor.
 */
async function fetchAllProducts(queryFilter) {
  const products = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await shopifyGraphQL(PRODUCTS_QUERY, {
      first: 50,
      after,
      query: queryFilter,
    });

    for (const edge of data.products.edges) {
      products.push(edge.node);
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }

  return products;
}

/**
 * Fetch all products in a collection, paginating with cursor.
 */
async function fetchCollectionProducts(collectionGid) {
  const products = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await shopifyGraphQL(COLLECTION_PRODUCTS_QUERY, {
      id: collectionGid,
      first: 50,
      after,
    });

    for (const edge of data.collection.products.edges) {
      products.push(edge.node);
    }

    hasNextPage = data.collection.products.pageInfo.hasNextPage;
    after = data.collection.products.pageInfo.endCursor;
  }

  return products;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const dryRun = args.includes('--dry-run');

  let collectionHandle = null;
  const collIdx = args.indexOf('--collection');
  if (collIdx !== -1 && args[collIdx + 1]) {
    collectionHandle = args[collIdx + 1];
  }

  let priceMin = null;
  const minIdx = args.indexOf('--price-min');
  if (minIdx !== -1 && args[minIdx + 1]) {
    priceMin = parseFloat(args[minIdx + 1]);
  }

  let priceMax = null;
  const maxIdx = args.indexOf('--price-max');
  if (maxIdx !== -1 && args[maxIdx + 1]) {
    priceMax = parseFloat(args[maxIdx + 1]);
  }

  let shippingProfile = null;
  const shipIdx = args.indexOf('--shipping-profile');
  if (shipIdx !== -1 && args[shipIdx + 1]) {
    shippingProfile = args[shipIdx + 1];
  }

  let outputFilename = null;
  const outIdx = args.indexOf('--output');
  if (outIdx !== -1 && args[outIdx + 1]) {
    outputFilename = args[outIdx + 1];
  }

  console.log(`\nExporting products for Whatnot...`);
  console.log(`  Collection: ${collectionHandle || '(all)'}`);
  console.log(`  Price min:  ${priceMin !== null ? `$${priceMin}` : '(none)'}`);
  console.log(`  Price max:  ${priceMax !== null ? `$${priceMax}` : '(none)'}`);
  console.log(`  Dry run:    ${dryRun}\n`);

  // Resolve collection handle → GID if needed
  let collectionGid = null;
  if (collectionHandle) {
    console.log('Fetching collections...');
    const colData = await shopifyGraphQL(COLLECTIONS_QUERY);
    for (const edge of colData.collections.edges) {
      if (edge.node.handle === collectionHandle) {
        collectionGid = edge.node.id;
        break;
      }
    }
    if (!collectionGid) {
      console.error(`ERROR  Collection not found: "${collectionHandle}"`);
      process.exit(1);
    }
    console.log(`  Resolved: ${collectionHandle} → ${collectionGid}\n`);
  }

  // Fetch products
  console.log('Fetching products from Shopify...');
  let products;
  if (collectionGid) {
    products = await fetchCollectionProducts(collectionGid);
  } else {
    products = await fetchAllProducts('status:active');
  }
  console.log(`  Fetched ${products.length} products\n`);

  // Filter: graded cards only, inventory > 0, price range
  const filtered = products.filter((p) => {
    if (p.productType !== 'Graded Card') return false;

    const variant = p.variants.edges[0]?.node;
    if (!variant) return false;
    if (variant.inventoryQuantity <= 0) return false;

    const price = parseFloat(variant.price);
    if (priceMin !== null && price < priceMin) return false;
    if (priceMax !== null && price > priceMax) return false;

    return true;
  });

  console.log(`  ${filtered.length} products after filtering (inventory > 0, price range)\n`);

  if (filtered.length === 0) {
    console.log('No products to export.');
    return;
  }

  // Map to Whatnot rows
  const rows = [WHATNOT_HEADERS];

  for (const product of filtered) {
    const variant = product.variants.edges[0].node;
    const metafields = parseMetafields(product.metafields.edges);
    const images = product.images.edges.map((e) => e.node.url);

    const options = {};
    if (shippingProfile) options.shippingProfile = shippingProfile;

    const row = mapToWhatnotRow(product, metafields, images, variant, options);
    rows.push(row);
  }

  // Dry run: print summary
  if (dryRun) {
    console.log('Preview (dry run):\n');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const title = row[2].substring(0, 50).padEnd(50);
      const price = `$${row[6]}`.padEnd(10);
      const qty = row[4];
      const condition = row[10] || '-';
      const imgCount = row.slice(13).filter(Boolean).length;
      console.log(`  ${title}  ${price}  qty:${qty}  ${condition}  ${imgCount} imgs`);
    }
    console.log(`\n${rows.length - 1} products would be exported.`);
    return;
  }

  // Write CSV
  const csv = toCSV(rows);
  const exportsDir = path.resolve(__dirname, '..', 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = outputFilename || `whatnot-export-${timestamp}.csv`;
  const outputPath = path.join(exportsDir, filename);

  fs.writeFileSync(outputPath, csv, 'utf8');
  console.log(`Exported ${rows.length - 1} products to ${outputPath}`);
}

main().catch((err) => {
  console.error(`\nFATAL  ${err.message}`);
  process.exit(1);
});
