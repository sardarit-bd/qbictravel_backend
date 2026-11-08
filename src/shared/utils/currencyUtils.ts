/**
 * Currency minor unit mappings according to ISO 4217 and Stripe standards.
 * Standard currencies use 2 decimal places (e.g. USD, EUR, THB, SGD, GBP, AUD).
 * Zero-decimal currencies have factor 1 (e.g. JPY, KRW, VND).
 * Three-decimal currencies have factor 1000 (e.g. BHD, KWD, OMR).
 */

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "JOD",
  "KWD",
  "OMR",
  "TND",
]);

/**
 * Returns the decimal power (multiplier) for a given ISO currency code.
 * E.g., USD -> 100, JPY -> 1, KWD -> 1000.
 */
export const getCurrencyMultiplier = (currency: string): number => {
  const upper = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) {
    return 1;
  }
  if (THREE_DECIMAL_CURRENCIES.has(upper)) {
    return 1000;
  }
  return 100;
};

/**
 * Converts a standard nominal currency amount (e.g., 2500.50 THB)
 * to Stripe's minor unit integer representation (e.g., 250050).
 */
export const toStripeAmount = (amount: number | string, currency: string): number => {
  const numeric = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(numeric) || numeric < 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const multiplier = getCurrencyMultiplier(currency);
  return Math.round(numeric * multiplier);
};

/**
 * Converts Stripe's minor unit integer representation back to standard nominal amount.
 */
export const fromStripeAmount = (stripeAmount: number, currency: string): number => {
  const multiplier = getCurrencyMultiplier(currency);
  return stripeAmount / multiplier;
};

