export type OptionType = "CALL" | "PUT";

export type NormalizedPosition = {
  id: string;
  company: string;
  exchangeSegment: string;
  instrumentToken: string;
  tradingSymbol: string;
  optionType: OptionType;
  strike: number;
  expiryIso: string;
  expiryLabel: string;
  netQuantity: number;
  lotSize: number;
};

export type ReportSide = {
  strike: number;
  inrNear: number | null;
  pctNear: number | null;
};

export type ReportRow = {
  company: string;
  spot: number | null;
  call: ReportSide | null;
  put: ReportSide | null;
};

export type ExpiryGroup = {
  expiryIso: string;
  expiryLabel: string;
  rows: ReportRow[];
};

export type MonitorSnapshot = {
  reportDate: string;
  generatedAt: string;
  optionPositionCount: number;
  downloadedPriceCount: number;
  missingSymbols: string[];
  groups: ExpiryGroup[];
};
