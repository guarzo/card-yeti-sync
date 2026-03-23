/**
 * HTTP client for the standalone Card Yeti Pricing API.
 * Fetches market comp prices by certification number.
 */

export interface PriceResult {
  certNumber: string;
  suggestedPrice: number;
  currency: string;
}

export interface BatchPriceResponse {
  results: PriceResult[];
  notFound: string[];
  totalRequested: number;
  totalFound: number;
}

function getConfig() {
  const url = process.env.PRICING_API_URL;
  const key = process.env.PRICING_API_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function isPricingApiConfigured(): boolean {
  return getConfig() !== null;
}

const BATCH_SIZE = 100;
const TIMEOUT_MS = 10_000;

/**
 * Fetch market comp prices for a list of cert numbers.
 * Automatically chunks into batches of 100.
 */
export async function fetchPriceBatch(
  certNumbers: string[],
): Promise<BatchPriceResponse> {
  const config = getConfig();
  if (!config) {
    throw new Error("Pricing API not configured. Set PRICING_API_URL and PRICING_API_KEY.");
  }

  const allResults: PriceResult[] = [];
  const allNotFound: string[] = [];

  for (let i = 0; i < certNumbers.length; i += BATCH_SIZE) {
    const chunk = certNumbers.slice(i, i + BATCH_SIZE);
    const response = await fetch(`${config.url}/prices/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ certNumbers: chunk }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 401) {
      throw new Error("Pricing API: invalid API key");
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") ?? "60";
      throw new Error(`Pricing API: rate limited, retry after ${retryAfter}s`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Pricing API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as BatchPriceResponse;
    allResults.push(...data.results);
    allNotFound.push(...data.notFound);
  }

  return {
    results: allResults,
    notFound: allNotFound,
    totalRequested: certNumbers.length,
    totalFound: allResults.length,
  };
}
