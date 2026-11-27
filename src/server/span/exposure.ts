import type { ElmRates, SpanContract, SpanUnderlying } from "./types";

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

export const DEFAULT_EXPOSURE_SOURCE = "nse_default_rates";

/** NSE circular CMPT44391: index 2% (3% beyond 10% OTM); stock 3.5% (5.25% beyond 30% OTM) plus any additional ELM from the daily AEL file. */
const INDEX_ELM: ElmRates = { normalPercent: 2, deepOutOfMoneyPercent: 3 };
const DEFAULT_STOCK_ELM: ElmRates = {
  normalPercent: 3.5,
  deepOutOfMoneyPercent: 5.25,
};
const INDEX_DEEP_OUT_OF_MONEY_FRACTION = 0.1;
const STOCK_DEEP_OUT_OF_MONEY_FRACTION = 0.3;

export function isIndexUnderlying(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

function outOfMoneyFraction(
  contract: Pick<SpanContract, "optionType" | "strike">,
  referencePrice: number,
): number {
  if (contract.strike === undefined || referencePrice <= 0) {
    return 0;
  }
  const distance =
    contract.optionType === "P"
      ? referencePrice - contract.strike
      : contract.strike - referencePrice;
  return distance / referencePrice;
}

export function exposureRate(
  underlying: Pick<SpanUnderlying, "symbol" | "spot" | "elm">,
  contract: Pick<SpanContract, "instrumentType" | "optionType" | "strike">,
): number {
  const isIndex = isIndexUnderlying(underlying.symbol);
  const rates = isIndex ? INDEX_ELM : (underlying.elm ?? DEFAULT_STOCK_ELM);
  const deepOutOfMoneyFraction = isIndex
    ? INDEX_DEEP_OUT_OF_MONEY_FRACTION
    : STOCK_DEEP_OUT_OF_MONEY_FRACTION;
  const isDeepOutOfMoney =
    contract.instrumentType === "OPT" &&
    outOfMoneyFraction(contract, underlying.spot) > deepOutOfMoneyFraction;
  return (
    (isDeepOutOfMoney ? rates.deepOutOfMoneyPercent : rates.normalPercent) / 100
  );
}

/** Options and futures both use the underlying price: Kotak's check-margin ELM is a flat rate of spot × qty at every strike. */
export function notionalValue(params: {
  quantity: number;
  underlyingPrice: number;
  cvf?: number;
}): number {
  return Math.abs(params.quantity) * params.underlyingPrice * (params.cvf ?? 1);
}
