import 'dotenv/config';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
  throw new Error('Missing SHOPIFY_STORE or SHOPIFY_ACCESS_TOKEN in .env');
}

const GRAPHQL_URL = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/2026-04/graphql.json`;

/**
 * Execute a Shopify Admin GraphQL query.
 * Returns the unwrapped `data` object from the response.
 */
export async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL error: ${res.status} ${text}`);
  }

  const json = await res.json();

  if (json.errors) {
    const messages = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Shopify GraphQL errors: ${messages}`);
  }

  return json.data;
}
