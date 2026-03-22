/**
 * Shared CSV parsing and TCG Automate transform logic.
 * Used by both clean-csv.js (CSV-to-CSV) and upload-products.js (CSV-to-API).
 */

// ── Config ──────────────────────────────────────────────────────────────────

export const SHOPIFY_DISCOUNT = 0.05;        // 5% less than eBay price
export const VENDOR = 'The Pokémon Company';
export const GRADED_WEIGHT_G = 85;           // ~3 oz for a slab
export const RAW_WEIGHT_G = 28;              // ~1 oz for a raw card in toploader

export const GRADERS = ['PSA', 'CGC', 'TAG', 'BGS', 'SGC', 'ACE', 'GMA', 'MNT'];
export const GRADER_REGEX = new RegExp(
  `\\b(${GRADERS.join('|')})\\s+(\\d+\\.?\\d*)\\s*$`, 'i'
);

// ── CSV parsing ─────────────────────────────────────────────────────────────

export function parseCSV(text) {
  const rows = [];
  let field = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (ch === '\r') i++;
    } else {
      field += ch;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function toCSV(rows) {
  return rows
    .map(row =>
      row
        .map(f => {
          const escaped = String(f).replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(',')
    )
    .join('\n');
}

export function buildColumnIndex(headers) {
  const col = {};
  headers.forEach((h, i) => { col[h] = i; });
  return col;
}

// ── Transform helpers ───────────────────────────────────────────────────────

export function removeTCGAutomateAds(html) {
  if (!html) return html;
  // Shopify format (<p> wrapped)
  html = html.replace(
    /\s*<p><img[^>]*TCG Automate[^>]*\/?><\/p>/gi, ''
  );
  html = html.replace(
    /\s*<p><strong>This listing was created with TCG Automate[^<]*<\/strong><\/p>/gi, ''
  );
  html = html.replace(
    /\s*<p><strong>Use code EBAY[^<]*<\/strong><\/p>/gi, ''
  );
  // eBay format (styled <div> block containing TCG Automate logo + text)
  html = html.replace(
    /\s*<div[^>]*>[\s\S]*?TCG Automate[\s\S]*?<\/div>\s*<\/div>/gi, ''
  );
  return html.trim();
}

/**
 * Parse the original tags array into structured card data.
 * TCG Automate tags follow: [pokemon, number, set_name, ...] but cards without
 * a card number skip that position.
 *
 * Card numbers are detected by containing "/" (e.g. "065/080") or being purely
 * numeric (e.g. "066", "6"). Set names never match either pattern.
 *
 * Graded card set names are prefixed with "Pokemon [Language]" (e.g.
 * "Pokemon Japanese Bonds To The End Of Time") which gets stripped.
 */
export function parseCardTags(originalTags) {
  const pokemon = originalTags[0] || '';
  const secondTag = originalTags[1] || '';
  const hasNumber = /\//.test(secondTag) || /^\d+$/.test(secondTag);

  let setName = hasNumber ? (originalTags[2] || '') : secondTag;
  // Strip "Pokemon [Language]" prefix added by TCG Automate
  setName = setName.replace(/^Pok[eé]mon\s+(?:Japanese|Simplified Chinese|Korean|Chinese)?\s*/i, '');

  return {
    pokemon,
    number: hasNumber ? secondTag : '',
    setName,
  };
}

export function parseGraderFromTitle(title) {
  const match = title.match(GRADER_REGEX);
  if (match) {
    return { grader: match[1].toUpperCase(), grade: match[2], isGraded: true };
  }
  return { grader: null, grade: null, isGraded: false };
}

/**
 * Clean up a TCG Automate title into a readable product title.
 * Input:  "Dragonite-Holo Pokemon Japanese Holon Research Tower 039 NM PSA 3"
 * Output: "Dragonite Holo - Holon Research Tower #039 [Japanese] PSA 3"
 *
 * Uses the original tags (pokemon, number, set_name) to reconstruct a cleaner title.
 */
export function cleanTitle(title, originalTags, info) {
  if (!title) return title;

  const { pokemon, number, setName } = parseCardTags(originalTags);

  // Detect holo/reverse/etc from original title
  const holoMatch = title.match(/\b(Holo|Reverse Holo|Full Art|Alt Art|Special Art Rare|Secret Rare)\b/i);
  const holoSuffix = holoMatch ? ` ${holoMatch[1]}` : '';

  const langTag = info.language !== 'English' ? ` [${info.language}]` : '';

  // Build clean title
  const parts = [];
  if (pokemon) {
    // Clean up hyphenated pokemon names (e.g., "Dragonite-Holo" → "Dragonite")
    const cleanPokemon = pokemon.replace(/-(Holo|Reverse|Full|Alt|Secret|Special)/i, '');
    parts.push(cleanPokemon + holoSuffix);
  }
  if (setName) {
    parts.push(setName);
  }
  if (number) {
    parts.push(`#${number}`);
  }

  let cleanedTitle = parts.join(' - ');
  if (langTag) cleanedTitle += langTag;

  if (info.isGraded && info.grader && info.grade) {
    cleanedTitle += ` ${info.grader} ${info.grade}`;
  }

  return cleanedTitle || title;
}

export function cleanTags(tags, title, info) {
  if (!tags) return tags;

  const list = tags
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => t !== title && t !== 'TCG');

  if (info.isGraded) {
    list.push('Graded');
    if (info.grader) list.push(`Grader:${info.grader}`);
    if (info.grade) list.push(`Grade:${info.grade}`);
  } else {
    list.push('Raw');
  }

  return [...new Set(list)].join(', ');
}

/**
 * Apply all per-row transforms to a CSV row in place.
 * Returns { info, originalPrice } for logging / further processing.
 */
export function applyTransforms(row, col) {
  const title = row[col['Title']];
  const handle = row[col['Handle']] || '';
  const info = parseGraderFromTitle(title);

  // Detect language from title and handle prefix
  if (/japanese/i.test(title) || /^jp-/i.test(handle)) {
    info.language = 'Japanese';
  } else if (/chinese/i.test(title)) {
    info.language = 'Chinese';
  } else if (/korean/i.test(title)) {
    info.language = 'Korean';
  } else {
    info.language = 'English';
  }
  info.isJapanese = info.language === 'Japanese';

  // 1. Remove TCG Automate ads
  row[col['Body (HTML)']] = removeTCGAutomateAds(row[col['Body (HTML)']]);

  if (col['SEO Description'] !== undefined) {
    row[col['SEO Description']] = removeTCGAutomateAds(row[col['SEO Description']]);
  }

  // 2. Set vendor
  row[col['Vendor']] = VENDOR;

  // 3. Fix Google Shopping condition
  row[col['Google Shopping / Condition']] = 'Used';

  // 4–5. Adjust price and set Compare At Price
  const originalPrice = parseFloat(row[col['Variant Price']]);
  if (!isNaN(originalPrice) && originalPrice > 0) {
    const shopifyPrice = (originalPrice * (1 - SHOPIFY_DISCOUNT)).toFixed(2);
    row[col['Variant Price']] = shopifyPrice;

    if (col['Variant Compare At Price'] !== undefined) {
      row[col['Variant Compare At Price']] = originalPrice.toFixed(2);
    }

    if (col['Price / United States'] !== undefined && row[col['Price / United States']]) {
      row[col['Price / United States']] = shopifyPrice;
    }
    if (col['Compare At Price / United States'] !== undefined) {
      row[col['Compare At Price / United States']] = originalPrice.toFixed(2);
    }
  }

  // 6. Save original tags before cleaning (pokemon, number, set_name)
  const rawTags = (row[col['Tags']] || '')
    .split(',').map(t => t.trim()).filter(Boolean)
    .filter(t => t !== title && t !== 'TCG');

  // 7. Clean up and enrich tags
  row[col['Tags']] = cleanTags(row[col['Tags']], title, info);

  // 8. Clean up title using original tag data
  row[col['Title']] = cleanTitle(title, rawTags, info);

  // 9. Set product type
  row[col['Type']] = info.isGraded ? 'Graded Card' : 'Raw Single';

  // 10. Fix weight
  if (col['Variant Grams'] !== undefined) {
    row[col['Variant Grams']] = info.isGraded
      ? String(GRADED_WEIGHT_G)
      : String(RAW_WEIGHT_G);
  }

  return { info, originalPrice };
}
