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

export function notionalValue(params: {
  quantity: number;
  underlyingPrice: number;
  strike?: number;
  instrumentType: "OPT" | "FUT";
  cvf?: number;
}): number {
  const cvf = params.cvf ?? 1;
  const unitPrice =
    params.instrumentType === "FUT"
      ? params.underlyingPrice
      : (params.strike ?? params.underlyingPrice);
  return Math.abs(params.quantity) * unitPrice * cvf;
}
