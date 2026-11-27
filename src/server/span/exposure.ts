const INDEX_SYMBOLS = new Set([
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "MIDCPNIFTY",
  "NIFTYNXT50",
  "BANKEX",
  "SENSEX",
  "SENSEX50",
]);

export const EXPOSURE_SOURCE = "nse_default_rates" as const;

export function isIndexUnderlying(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

export function exposureRate(
  symbol: string,
  instrumentType: "OPT" | "FUT",
): number {
  void instrumentType;
  return isIndexUnderlying(symbol) ? 0.02 : 0.035;
}

/** Options and futures both use the underlying price: Kotak's check-margin ELM is a flat rate of spot × qty at every strike. */
export function notionalValue(params: {
  quantity: number;
  underlyingPrice: number;
  cvf?: number;
}): number {
  return Math.abs(params.quantity) * params.underlyingPrice * (params.cvf ?? 1);
}
