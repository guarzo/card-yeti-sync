/**
 * Whatnot CSV column definitions, description builder, and row mapper.
 *
 * Column names are centralized here for easy adjustment after verifying
 * against the actual Whatnot seller bulk-upload template.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const WHATNOT_HEADERS = [
  'Category',
  'Sub Category',
  'Title',
  'Description',
  'Quantity',
  'Type',
  'Price',
  'Shipping Profile',
  'Offerable',
  'Hazmat',
  'Condition',
  'Cost Per Item',
  'SKU',
  'Image URL 1',
  'Image URL 2',
  'Image URL 3',
  'Image URL 4',
  'Image URL 5',
  'Image URL 6',
  'Image URL 7',
  'Image URL 8',
];

export const WHATNOT_CATEGORY = 'Trading Card Games';
export const WHATNOT_SUBCATEGORY = 'Pokémon Cards';

// Default shipping profile by product type (weight-based)
export const SHIPPING_PROFILES = {
  'Graded Card': '4-8 oz',
  'Raw Single': '0-1 oz',
  'Curated Lot': '4-8 oz',
  'Sealed Product': '9 oz - 1 lb',
};

// ── Description builder ──────────────────────────────────────────────────────

/**
 * Build a plain-text Whatnot description from product metafields and data.
 *
 * Format:
 *   [Pokemon] - [Set Name] #[Number]
 *   [Grader] [Grade] | Cert: [cert_number]
 *   Condition: [condition] | Language: [language]
 *   eBay Comp: $[ebay_comp]
 *   cardyeti.com
 */
export function buildWhatnotDescription(metafields, product) {
  const lines = [];

  // Line 1: Pokemon - Set Name #Number
  const pokemon = metafields.pokemon || '';
  const setName = metafields.set_name || '';
  const number = metafields.number || '';
  const parts = [];
  if (pokemon) parts.push(pokemon);
  if (setName) parts.push(setName);
  if (number) parts.push(`#${number}`);
  if (parts.length > 0) {
    lines.push(parts.join(' - '));
  }

  // Line 2: Grader Grade | Cert: cert_number
  const grader = metafields.grading_company || '';
  const grade = metafields.grade || '';
  const cert = metafields.cert_number || '';
  if (grader && grade) {
    let gradeLine = `${grader} ${grade}`;
    if (cert) gradeLine += ` | Cert: ${cert}`;
    lines.push(gradeLine);
  }

  // Line 3: Condition | Language
  const condition = metafields.condition || '';
  const language = metafields.language || '';
  const condParts = [];
  if (condition) condParts.push(`Condition: ${condition}`);
  if (language) condParts.push(`Language: ${language}`);
  if (condParts.length > 0) {
    lines.push(condParts.join(' | '));
  }

  // Line 4: eBay Comp
  const ebayComp = metafields.ebay_comp || '';
  if (ebayComp) {
    lines.push(`eBay Comp: $${ebayComp}`);
  }

  // Line 5: Store URL
  lines.push('cardyeti.com');

  return lines.join('\n');
}

// ── Row mapper ───────────────────────────────────────────────────────────────

/**
 * Map a Shopify product to a Whatnot CSV row (array matching WHATNOT_HEADERS).
 *
 * @param {object} product   - Shopify product node
 * @param {object} metafields - Key-value map of card namespace metafields
 * @param {string[]} images  - Array of image URLs
 * @param {object} variant   - Primary variant node
 * @param {object} options   - { shippingProfile }
 * @returns {string[]}
 */
export function mapToWhatnotRow(product, metafields, images, variant, options = {}) {
  const title = product.title || '';
  const description = buildWhatnotDescription(metafields, product);
  const quantity = variant.inventoryQuantity > 0 ? String(variant.inventoryQuantity) : '1';
  // BIN price = eBay comp (compareAtPrice) rounded up to whole dollar; fall back to variant price
  const rawPrice = parseFloat(variant.compareAtPrice) || parseFloat(variant.price) || 0;
  const price = String(Math.ceil(rawPrice));
  const productType = product.productType || '';
  const shippingProfile = options.shippingProfile || SHIPPING_PROFILES[productType] || 'Standard';

  const condition = productType === 'Graded Card' ? 'Graded'
    : productType === 'Sealed Product' ? 'Brand New'
    : 'Used';

  // Image URLs (up to 8)
  const imageSlots = [];
  for (let i = 0; i < 8; i++) {
    imageSlots.push(images[i] || '');
  }

  // SKU from variant
  const sku = variant.sku || '';

  return [
    WHATNOT_CATEGORY,
    WHATNOT_SUBCATEGORY,
    title,
    description,
    quantity,
    'Buy it Now',
    price,
    shippingProfile,
    'TRUE',
    'Not Hazmat',
    condition,
    '',
    sku,
    ...imageSlots,
  ];
}
