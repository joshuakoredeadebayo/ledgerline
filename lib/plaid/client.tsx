import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// Singleton so we're not re-reading env vars and constructing a new
// client on every request. PLAID_ENV should be "sandbox" for now —
// switching to "development" or "production" later is just an env
// var change, nothing in this file needs to know which one is active.
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);