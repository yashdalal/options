import type { AccountId } from "@/config/accounts";

export type OptionType = "CALL" | "PUT";

export type NormalizedPosition = {
  id: string;
  accountId: AccountId;
  accountLabel: string;
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
  lots: number;
  shares: number;
  inrNear: number | null;
  pctNear: number | null;
};

export type ReportRowDetail = {
  accountId: AccountId;
  accountLabel: string;
  call: ReportSide | null;
  put: ReportSide | null;
};

export type ReportRow = {
  company: string;
  spot: number | null;
  call: ReportSide | null;
  put: ReportSide | null;
  details: ReportRowDetail[];
};

export type ExpiryGroup = {
  expiryIso: string;
  expiryLabel: string;
  rows: ReportRow[];
};

export type AccountPositionSummary = {
  accountId: AccountId;
  accountLabel: string;
  optionPositionCount: number;
};

export type MonitorSnapshot = {
  reportDate: string;
  generatedAt: string;
  optionPositionCount: number;
  downloadedPriceCount: number;
  missingSymbols: string[];
  accountSummaries: AccountPositionSummary[];
  groups: ExpiryGroup[];
};

export type ScreenSideFilter = "CALL" | "PUT" | "BOTH";

export type ScreenCandidate = {
  company: string;
  optionType: OptionType;
  strike: number;
  spot: number;
  spreadPct: number;
  priceDiffInr: number;
  premium: number;
  lotSize: number;
  lots: number;
  netPremium: number;
  calendarDaysLeft: number;
  expiryIso: string;
  instrumentToken: string;
  exchangeSegment: string;
  tradingSymbol: string;
  margin: number | null;
  annualizedReturnPct: number | null;
  meetsSpread: boolean;
  meetsReturn: boolean | null;
};

export type ScreenSnapshot = {
  generatedAt: string;
  company: string;
  expiryIso: string;
  spot: number | null;
  calendarDaysLeft: number | null;
  candidates: ScreenCandidate[];
};

export type ScreenMeta = {
  underlyings: string[];
  expiriesByUnderlying: Record<string, string[]>;
};
