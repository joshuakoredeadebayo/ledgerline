// Thin OAuth2 + REST helpers for QuickBooks Online (Intuit). No SDK
// dependency — the OAuth2 flow is standard enough that plain fetch
// calls are simpler than adding a package, and it keeps this
// consistent with the rest of the app's style.

const AUTHORIZATION_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

// Name of the httpOnly cookie used to carry the CSRF state token
// across the OAuth redirect round trip to Intuit and back.
export const QUICKBOOKS_STATE_COOKIE = "qb_oauth_state";

function apiBaseUrl(): string {
  return process.env.QUICKBOOKS_ENV === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function basicAuthHeader(): string {
  const credentials = `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

export function getQuickBooksAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QUICKBOOKS_CLIENT_ID!,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: process.env.QUICKBOOKS_REDIRECT_URI!,
    state,
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export async function exchangeCodeForTokens(code: string): Promise<QuickBooksTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.QUICKBOOKS_REDIRECT_URI!,
    }),
  });

  if (!response.ok) {
    throw new Error(`QuickBooks token exchange failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export async function refreshQuickBooksTokens(refreshToken: string): Promise<QuickBooksTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`QuickBooks token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  // QuickBooks rotates the refresh token on every use — the previous
  // one stops working, so the new one must always be saved too, not
  // just the new access token.
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export async function revokeQuickBooksToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  });
}

export interface QuickBooksCompanyInfo {
  companyName: string;
}

export async function getCompanyInfo(realmId: string, accessToken: string): Promise<QuickBooksCompanyInfo> {
  const response = await fetch(`${apiBaseUrl()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`QuickBooks company info fetch failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return { companyName: data.CompanyInfo?.CompanyName ?? "QuickBooks Company" };
}
