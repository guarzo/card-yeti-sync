import 'dotenv/config';

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env');
}

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_API = 'https://api.ebay.com/buy/browse/v1';

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get an OAuth application token (client_credentials grant).
 * Tokens are cached until they expire.
 */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay OAuth error: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Expire 60s early to be safe
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Fetch a single eBay item by its item ID (numeric or legacy format).
 * Uses the Browse API GetItem endpoint.
 *
 * Accepts:
 *   - Legacy item ID: "325678901234"
 *   - Full item ID: "v1|325678901234|0"
 */
export async function getItem(itemId) {
  const token = await getToken();

  // Normalize to full item ID format
  const fullId = itemId.includes('|') ? itemId : `v1|${itemId}|0`;

  const url = `${BROWSE_API}/item/${encodeURIComponent(fullId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay Browse API error (${itemId}): ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Search eBay by keyword (for future use).
 */
export async function searchItems(query, limit = 10) {
  const token = await getToken();

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const url = `${BROWSE_API}/item_summary/search?${params}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay search error: ${res.status} ${text}`);
  }

  return res.json();
}
