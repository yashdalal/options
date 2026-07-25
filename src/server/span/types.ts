export type SpanInstrumentType = "OPT" | "FUT";

export type SpanOptionType = "C" | "P";

export type SpanContract = {
  instrumentType: SpanInstrumentType;
  optionType?: SpanOptionType;
  expiry: string;
  strike?: number;
  price: number;
  cvf: number;
  riskArray: number[];
  compositeDelta: number;
};

export type SpanSpreadLeg = {
  expiry: string;
  side: "A" | "B" | string;
  ratio: number;
};

export type SpanCalendarSpread = {
  priority: number;
  chargeMethod: string;
  rate: number;
  legs: SpanSpreadLeg[];
};

export type SpanUnderlying = {
  symbol: string;
  spot: number;
  somRate: number;
  contracts: SpanContract[];
  spreads: SpanCalendarSpread[];
};

export type SpanSnapshotMeta = {
  date: string;
  variant: string;
  created?: string;
  fetchedAt: string;
  underlyingCount: number;
  underlyings: string[];
  exposureSource: "nse_default_rates";
};

export type SpanPosition = {
  underlying: string;
  instrumentType: SpanInstrumentType;
  optionType?: "CALL" | "PUT";
  expiryIso: string;
  strike?: number;
  quantity: number;
};

export type MarginBreakdown = {
  span: number;
  exposure: number;
  total: number;
};

export type BasketMarginResult = {
  spanFile: { date: string; variant: string; exposureSource: string };
  basket: MarginBreakdown;
  account: {
    accountId: string;
    current: MarginBreakdown;
    after: MarginBreakdown;
    incremental: MarginBreakdown;
  } | null;
  deliveryMarginWarning: string | null;
};
