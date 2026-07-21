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
