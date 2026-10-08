/**
 * The "Add a test transaction" form lets someone type in a fake bank or ledger line.
 * That is invaluable while building against sandbox data and dangerous in production,
 * so it is on in sandbox and off once Plaid is running in production, unless explicitly
 * switched on with ENABLE_TEST_TRANSACTIONS=true.
 */
export function testToolsEnabled(): boolean {
  return process.env.PLAID_ENV !== "production" || process.env.ENABLE_TEST_TRANSACTIONS === "true";
}
