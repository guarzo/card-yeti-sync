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
 * Returns the updated account (with new tokens if refreshed) and the response.
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

/**
 * Revoke an eBay OAuth token (typically the refresh token).
 * Logs warnings but never throws — disconnect flow must always complete.
 */
export async function revokeToken(token: string): Promise<void> {
  const endpoints = getEndpoints();
  const res = await fetch(`${endpoints.api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${getBasicAuth()}`,
    },
    body: new URLSearchParams({ token }),
  });

  if (!res.ok) {
    console.warn(
      `eBay token revocation failed: ${res.status} ${await res.text()}`,
    );
  }
}
