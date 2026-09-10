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

// Maps QuickBooks' chart-of-accounts AccountType values onto
// Ledgerline's five buckets, the same role mapPlaidTypeToAccountType
// plays for Plaid accounts in lib/actions/plaid.ts.
export function mapQuickBooksAccountType(qbAccountType: string): "asset" | "liability" | "equity" | "revenue" | "expense" {
  switch (qbAccountType) {
    case "Bank":
    case "Other Current Asset":
    case "Fixed Asset":
    case "Other Asset":
    case "Accounts Receivable":
      return "asset";
    case "Accounts Payable":
    case "Credit Card":
    case "Other Current Liability":
    case "Long Term Liability":
      return "liability";
    case "Equity":
      return "equity";
    case "Income":
    case "Other Income":
      return "revenue";
    case "Expense":
    case "Other Expense":
    case "Cost of Goods Sold":
      return "expense";
    default:
      return "asset";
  }
}

/**
 * Runs a query against QuickBooks' SQL-like Query API
 * (https://developer.intuit.com/.../query). Used for both the chart
 * of accounts and transaction pulls, since QuickBooks — unlike Plaid —
 * has no single unified "transactions" endpoint; each transaction
 * type (Purchase, Deposit, etc.) is its own queryable resource.
 */
export async function queryQuickBooks<T = any>(realmId: string, accessToken: string, query: string): Promise<T[]> {
  const response = await fetch(
    `${apiBaseUrl()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`QuickBooks query failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  // QueryResponse's key varies by entity — e.g. QueryResponse.Account,
  // QueryResponse.Purchase — so pull whichever array key is present
  // rather than requiring the caller to know QuickBooks' exact naming.
  const queryResponse = data.QueryResponse ?? {};
  const arrayKey = Object.keys(queryResponse).find((k) => Array.isArray(queryResponse[k]));
  return arrayKey ? queryResponse[arrayKey] : [];
}

export interface QuickBooksItemRow {
  id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
}

/**
 * Returns a valid access token for this connection, refreshing and
 * persisting a new one first if the current one is expired or close
 * to it. Every QuickBooks action (account import, transaction sync)
 * needs this, since access tokens only last about an hour — unlike
 * Plaid's, which don't expire the same way.
 */
export async function getValidAccessToken(
  item: QuickBooksItemRow,
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>
): Promise<string> {
  const expiresAt = new Date(item.access_token_expires_at).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt - Date.now() > fiveMinutes) {
    return item.access_token;
  }

  const tokens = await refreshQuickBooksTokens(item.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

  await supabase
    .from("quickbooks_items")
    .update({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      access_token_expires_at: newExpiresAt,
    })
    .eq("id", item.id);

  return tokens.accessToken;
}