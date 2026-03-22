/**
 * Shared product-building logic used by both upload-products.js and import-from-ebay.js.
 *
 * Converts a normalized `card` data object into Shopify productSet inputs,
 * including title generation, tag building, metafield extraction, collection
 * resolution, and the productSet GraphQL mutation.
 */

import { shopifyGraphQL } from './shopify-client.js';
import {
  SHOPIFY_DISCOUNT,
  GRADED_WEIGHT_G,
  RAW_WEIGHT_G,
  VENDOR,
  removeTCGAutomateAds,
} from './csv-transforms.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const CERT_URL_BUILDERS = {
  PSA: (cert) => `https://www.psacard.com/cert/${cert}`,
  CGC: (cert) => `https://www.cgccards.com/certlookup/${cert}`,
  BGS: (cert) => `https://www.beckett.com/grading/card-lookup?cert_number=${cert}`,
  SGC: (cert) => `https://www.gosgc.com/card-lookup?CertNo=${cert}`,
};

export const COLLECTION_MAP = {
  graded: ['graded-cards'],
};
export const JAPANESE_COLLECTION = 'japanese-cards';

export const VINTAGE_SETS = [
  'base set', 'jungle', 'fossil', 'team rocket', 'gym heroes', 'gym challenge',
  'neo genesis', 'neo discovery', 'neo revelation', 'neo destiny',
  'legendary collection', 'expedition', 'aquapolis', 'skyridge',
  'base set 2', 'southern islands',
];

export const DELAY_MS = 500;

// ── GraphQL ──────────────────────────────────────────────────────────────────

export const PRODUCT_SET_MUTATION = `
  mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $input) {
      product {
        id
        title
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const COLLECTIONS_QUERY = `
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

export const LOCATIONS_QUERY = `
  {
    locations(first: 1) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

export const PUBLICATIONS_QUERY = `
  {
    publications(first: 20) {
      edges {
        node { id name }
      }
    }
  }
`;

export const PUBLISH_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  query productByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
    }
  }
`;

export const PRODUCTS_BY_TAG_QUERY = `
  query productsByTag($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const TAGS_REMOVE_MUTATION = `
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

export function isVintageSet(setName) {
  if (!setName) return false;
  const lower = setName.toLowerCase();
  return VINTAGE_SETS.some((s) => lower.includes(s));
}

// ── Card → Shopify builders ──────────────────────────────────────────────────

export function buildTitle(card) {
  const parts = [];

  if (card.pokemon) {
    parts.push(card.pokemon);
  }

  if (card.setName) {
    parts.push(card.setName);
  }

  if (card.number) {
    parts.push(`#${card.number}`);
  }

  let title = parts.join(' - ');

  if (card.language !== 'English') {
    title += ` [${card.language}]`;
  }

  if (card.isGraded && card.grader && card.grade) {
    title += ` ${card.grader} ${card.grade}`;
  }

  return title || card.title;
}

export function buildTags(card) {
  const tags = [];

  if (card.pokemon) tags.push(card.pokemon);
  if (card.setName) tags.push(card.setName);
  if (card.rarity) tags.push(card.rarity);
  if (card.year) tags.push(card.year);

  if (card.isGraded) {
    tags.push('Graded');
    if (card.grader) tags.push(`Grader:${card.grader}`);
    if (card.grade) tags.push(`Grade:${card.grade}`);
  } else {
    tags.push('Raw');
  }

  if (card.isJapanese) tags.push('Japanese');

  return [...new Set(tags)];
}

export function buildMetafields(card) {
  const metafields = [];

  function add(key, value, type) {
    if (value !== null && value !== undefined && value !== '') {
      metafields.push({ namespace: 'card', key, value: String(value), type });
    }
  }

  add('pokemon', card.pokemon, 'single_line_text_field');
  add('number', card.number, 'single_line_text_field');
  add('set_name', card.setName, 'single_line_text_field');
  add('language', card.language, 'single_line_text_field');
  add('year', card.year, 'single_line_text_field');
  add('rarity', card.rarity, 'single_line_text_field');
  add('type_label', card.isGraded ? 'Graded Slab' : 'Raw Single', 'single_line_text_field');

  if (card.isGraded) {
    add('grading_company', card.grader, 'single_line_text_field');
    add('grade', card.grade, 'single_line_text_field');
  }

  if (card.certNumber) {
    add('cert_number', card.certNumber, 'single_line_text_field');
    const builder = CERT_URL_BUILDERS[card.grader];
    if (builder) {
      add('cert_url', builder(card.certNumber), 'url');
    }
  }

  if (card.ebayPrice > 0) {
    add('ebay_comp', card.ebayPrice.toFixed(2), 'number_decimal');
  }

  if (!card.isGraded && card.condition) {
    add('condition', card.condition, 'single_line_text_field');
  }

  if (card.ebayItemId) {
    add('ebay_item_id', card.ebayItemId, 'single_line_text_field');
  }

  return metafields;
}

export function resolveCollections(card, collectionMap) {
  const handles = [];

  if (card.isGraded) {
    handles.push(...COLLECTION_MAP.graded);
  }

  if (card.isJapanese) {
    handles.push(JAPANESE_COLLECTION);
  }

  if (isVintageSet(card.setName)) {
    handles.push('vintage-cards');
  } else if (card.isGraded) {
    handles.push('modern-cards');
  }

  return handles.map((h) => collectionMap[h]).filter(Boolean);
}

export function buildProductInput(card, metafields, collectionGids, locationId, status, existingId, addNewArrivalTag) {
  const title = buildTitle(card);
  const handle = card.customLabel ? slugify(card.customLabel) : slugify(title);
  const tags = buildTags(card);
  if (addNewArrivalTag && !tags.includes('new-arrival')) {
    tags.push('new-arrival');
  }

  const shopifyPrice = card.ebayPrice > 0
    ? (card.ebayPrice * (1 - SHOPIFY_DISCOUNT)).toFixed(2)
    : '0.00';
  const compareAtPrice = card.ebayPrice > 0 ? card.ebayPrice.toFixed(2) : '';

  const templateSuffix = card.isGraded ? 'graded-card' : null;

  let sku = '';
  if (card.isGraded && card.certNumber) {
    sku = `${card.grader}-${card.certNumber}`;
  } else if (card.customLabel) {
    sku = card.customLabel;
  } else if (card.ebayItemId) {
    sku = `EBAY-${card.ebayItemId}`;
  } else {
    sku = handle;
  }

  const input = {
    title,
    handle,
    descriptionHtml: card.description || '',
    vendor: VENDOR,
    productType: card.isGraded ? 'Graded Card' : 'Raw Single',
    tags,
    status: status.toUpperCase(),
    templateSuffix,
    metafields,
    ...(existingId ? { id: existingId } : {}),
  };

  if (collectionGids.length > 0) {
    input.collections = collectionGids;
  }

  if (card.imageUrls.length > 0) {
    input.files = card.imageUrls.map((url) => ({
      originalSource: url,
      alt: title,
      contentType: 'IMAGE',
    }));
  }

  const weightGrams = card.isGraded ? GRADED_WEIGHT_G : RAW_WEIGHT_G;
  const variant = {
    optionValues: [{ name: 'Default Title', optionName: 'Title' }],
    price: shopifyPrice,
    sku,
    inventoryItem: {
      measurement: {
        weight: { value: weightGrams, unit: 'GRAMS' },
      },
    },
  };

  if (compareAtPrice) variant.compareAtPrice = compareAtPrice;

  if (locationId) {
    variant.inventoryQuantities = [{
      locationId,
      name: 'available',
      quantity: 1,
    }];
  }

  input.productOptions = [{ name: 'Title', values: [{ name: 'Default Title' }] }];
  input.variants = [variant];

  return input;
}

export async function removeNewArrivalTags() {
  const products = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await shopifyGraphQL(PRODUCTS_BY_TAG_QUERY, {
      first: 50,
      after,
      query: 'tag:new-arrival',
    });

    for (const edge of data.products.edges) {
      products.push(edge.node);
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }

  if (products.length === 0) {
    console.log('  No existing products with new-arrival tag.\n');
    return 0;
  }

  console.log(`  Removing new-arrival tag from ${products.length} products...`);
  let successCount = 0;
  for (const product of products) {
    const data = await shopifyGraphQL(TAGS_REMOVE_MUTATION, {
      id: product.id,
      tags: ['new-arrival'],
    });
    const errors = data.tagsRemove.userErrors;
    if (errors && errors.length > 0) {
      console.log(`    WARN  ${product.title.substring(0, 50)} — ${errors[0].message}`);
    } else {
      successCount++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`  Removed new-arrival tag from ${successCount} products.\n`);
  return successCount;
}

/**
 * Fetch Shopify store data needed for product upload (collections, location, publications).
 */
export async function fetchStoreData() {
  console.log('Fetching store data from Shopify...');

  const collectionMap = {};
  const colData = await shopifyGraphQL(COLLECTIONS_QUERY);
  for (const edge of colData.collections.edges) {
    collectionMap[edge.node.handle] = edge.node.id;
  }
  console.log(`  Collections: ${Object.keys(collectionMap).length} found`);

  let locationId = null;
  const locData = await shopifyGraphQL(LOCATIONS_QUERY);
  if (locData.locations.edges.length > 0) {
    locationId = locData.locations.edges[0].node.id;
    console.log(`  Location:    ${locationId}`);
  }

  const publicationInputs = [];
  const pubData = await shopifyGraphQL(PUBLICATIONS_QUERY);
  const pubNames = [];
  for (const edge of pubData.publications.edges) {
    publicationInputs.push({ publicationId: edge.node.id });
    pubNames.push(edge.node.name);
  }
  console.log(`  Publish to:  ${pubNames.join(', ')}`);
  console.log('');

  return { collectionMap, locationId, publicationInputs };
}

/**
 * Upload a single card to Shopify via productSet, with dedup and publishing.
 */
export async function uploadCard(card, { collectionMap, locationId, publicationInputs, status, dryRun, rotateNewArrivals }) {
  const metafields = buildMetafields(card);
  const collectionGids = resolveCollections(card, collectionMap);
  const title = buildTitle(card);
  const handle = card.customLabel ? slugify(card.customLabel) : slugify(title);

  // Dedup: check by handle
  let existingId = null;
  if (!dryRun) {
    try {
      const existing = await shopifyGraphQL(PRODUCT_BY_HANDLE_QUERY, { handle });
      if (existing.productByHandle) {
        existingId = existing.productByHandle.id;
      }
    } catch (err) {
      console.debug(`  Handle lookup miss for "${handle}": ${err.message}`);
    }
  }

  const input = buildProductInput(
    card, metafields, collectionGids, locationId, status, existingId, rotateNewArrivals
  );

  const typeStr = card.isGraded ? `${card.grader} ${card.grade}` : 'Raw';
  const priceStr = card.ebayPrice > 0
    ? `$${card.ebayPrice.toFixed(2)} → $${(card.ebayPrice * (1 - SHOPIFY_DISCOUNT)).toFixed(2)}`
    : 'no price';
  const mfStr = `${metafields.length} metafields`;

  if (dryRun) {
    const tagStr = rotateNewArrivals ? '  +new-arrival' : '';
    console.log(`  DRY   ${title.substring(0, 50).padEnd(50)}  ${typeStr.padEnd(10)}  ${priceStr}  ${mfStr}${tagStr}`);
    for (const mf of metafields) {
      console.log(`          ${mf.key}: ${mf.value.substring(0, 60)}`);
    }
    return 'created';
  }

  try {
    const data = await shopifyGraphQL(PRODUCT_SET_MUTATION, {
      input,
      synchronous: true,
    });

    const errors = data.productSet.userErrors;
    if (errors && errors.length > 0) {
      console.log(`  FAIL  ${title.substring(0, 50).padEnd(50)}  ${errors[0].message}`);
      for (const err of errors) {
        console.log(`          [${err.code}] ${err.field}: ${err.message}`);
      }
      return 'failed';
    }

    const product = data.productSet.product;
    console.log(`  OK    ${title.substring(0, 50).padEnd(50)}  ${typeStr.padEnd(10)}  ${priceStr}  → ${product.id}`);

    if (publicationInputs.length > 0) {
      const pubData = await shopifyGraphQL(PUBLISH_MUTATION, {
        id: product.id,
        input: publicationInputs,
      });
      const pubErrors = pubData.publishablePublish.userErrors;
      if (pubErrors.length > 0) {
        console.log(`          WARN  publish failed: ${pubErrors[0].message}`);
      }
    }

    return 'created';
  } catch (err) {
    console.log(`  FAIL  ${title.substring(0, 50).padEnd(50)}  ${err.message.substring(0, 120)}`);
    return 'failed';
  }
}
