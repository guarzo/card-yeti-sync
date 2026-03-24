import type { MarketplaceAccount } from "@prisma/client";

const EBAY_ENDPOINTS = {
  sandbox: {
    auth: "https://auth.sandbox.ebay.com/oauth2/authorize",
    token: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    api: "https://api.sandbox.ebay.com",
  },
  production: {
    auth: "https://auth.ebay.com/oauth2/authorize",
    token: "https://api.ebay.com/identity/v1/oauth2/token",
    api: "https://api.ebay.com",
  },
} as const;

const SELL_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");

function getEnv() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RU_NAME;
  const environment = (process.env.EBAY_ENVIRONMENT || "sandbox") as
    | "sandbox"
    | "production";

  if (!clientId || !clientSecret || !ruName) {
    throw new Error(
      "Missing EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, or EBAY_RU_NAME",
    );
  }

  return { clientId, clientSecret, ruName, environment };
}

function getEndpoints() {
  const { environment } = getEnv();
  return EBAY_ENDPOINTS[environment];
}

function getBasicAuth() {
  const { clientId, clientSecret } = getEnv();
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

/**
 * Build the eBay consent URL for the OAuth redirect.
 * The state parameter should be a unique value to prevent CSRF.
 */
export function getAuthorizationUrl(state: string): string {
  const { clientId, ruName } = getEnv();
  const endpoints = getEndpoints();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: ruName,
    scope: SELL_SCOPES,
    state,
  });

  return `${endpoints.auth}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const { ruName } = getEnv();
  const endpoints = getEndpoints();

  const res = await fetch(endpoints.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${getBasicAuth()}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Refresh an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const endpoints = getEndpoints();

  const res = await fetch(endpoints.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${getBasicAuth()}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SELL_SCOPES,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Make an authenticated API call to any eBay Sell API.
 * Handles reactive refresh: on 401, refreshes the token and retries once.
 *
 * Returns the raw HTTP response and, if a token refresh occurred, the new
 * access token and expiry. The caller is responsible for persisting updated tokens.
 */
export async function ebayApiCall(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  account: MarketplaceAccount,
): Promise<{ response: Response; updatedTokens: TokenUpdate | null }> {
  const endpoints = getEndpoints();
  const url = `${endpoints.api}${path}`;

  const doFetch = (token: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  let res = await doFetch(account.accessToken);

  // Reactive refresh: if 401, refresh token and retry once
  if (res.status === 401 && account.refreshToken) {
    const refreshed = await refreshAccessToken(account.refreshToken);
    res = await doFetch(refreshed.accessToken);

    return {
      response: res,
      updatedTokens: {
        accessToken: refreshed.accessToken,
        tokenExpiry: new Date(Date.now() + refreshed.expiresIn * 1000),
      },
    };
  }

  return { response: res, updatedTokens: null };
}

export type TokenUpdate = {
  accessToken: string;
  tokenExpiry: Date;
};

// ── Browse API (client_credentials grant) ────────────────────────────────────

let cachedAppToken: string | null = null;
let appTokenExpiry = 0;
let tokenRefreshPromise: Promise<string> | null = null;

async function getClientCredentialsToken(): Promise<string> {
  if (cachedAppToken && Date.now() < appTokenExpiry) return cachedAppToken;

  // Coalesce concurrent refresh calls to avoid thundering herd
  if (!tokenRefreshPromise) {
    tokenRefreshPromise = (async () => {
      const endpoints = getEndpoints();
      const res = await fetch(endpoints.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${getBasicAuth()}`,
        },
        body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`eBay OAuth (client_credentials) error: ${res.status} ${text}`);
      }

      const data = await res.json();
      cachedAppToken = data.access_token;
      // Expire 60s early to be safe
      appTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return cachedAppToken!;
    })().finally(() => {
      tokenRefreshPromise = null;
    });
  }

  return tokenRefreshPromise;
}

export interface EbayBrowseItem {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price?: { value: string; currency: string };
  localizedAspects?: Array<{ name: string; value: string }>;
  image?: { imageUrl: string };
  additionalImages?: Array<{ imageUrl: string }>;
  description?: string;
}

/**
 * Fetch a single eBay item by its item ID using the Browse API.
 * Uses client_credentials grant (no user auth needed).
 */
export async function getEbayBrowseItem(
  itemId: string,
  marketplaceId = "EBAY_US",
): Promise<EbayBrowseItem> {
  let token = await getClientCredentialsToken();
  const endpoints = getEndpoints();

  // Normalize to full item ID format
  const fullId = itemId.includes("|") ? itemId : `v1|${itemId}|0`;

  const url = `${endpoints.api}/buy/browse/v1/item/${encodeURIComponent(fullId)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
  };
  let res = await fetch(url, { headers });

  // If 401, invalidate cached token and retry once
  if (res.status === 401) {
    cachedAppToken = null;
    appTokenExpiry = 0;
    token = await getClientCredentialsToken();
    headers.Authorization = `Bearer ${token}`;
    res = await fetch(url, { headers });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay Browse API error (${itemId}): ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.itemId || typeof data.title !== "string") {
    throw new Error(`eBay Browse API returned unexpected shape for ${itemId}`);
  }
  return data as EbayBrowseItem;
}

