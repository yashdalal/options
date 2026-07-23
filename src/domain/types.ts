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
  id: string;
  company: string;
  optionType: OptionType;
  strike: number;
  spot: number;
  spreadPct: number;
  priceDiffInr: number;
  premium: number | null;
  hasBid: boolean;
  lotSize: number;
  lots: number;
  fillIndex: number;
  netPremium: number | null;
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

export type ScreenCoverage = {
  maxPerSide: number;
  nearBand: number;
  quoted: number;
  omittedByCap: number;
  noBid: number;
  belowSpreadMin: number;
  shown: number;
  meetsSpreadMinWithBid: number;
};

export type PriceBand = {
  high: number | null;
  low: number | null;
};

export type UnderlyingPriceRanges = {
  oneMonth: PriceBand;
  threeMonth: PriceBand;
  oneYear: PriceBand;
};

export type BoardMeetingInfo = {
  dateIso: string;
  purpose: string;
  description: string;
};

export type ScreenSnapshot = {
  generatedAt: string;
  company: string;
  expiryIso: string;
  spot: number | null;
  calendarDaysLeft: number | null;
  workingDaysLeft: number | null;
  coverage: ScreenCoverage | null;
  candidates: ScreenCandidate[];
  priceRanges: UnderlyingPriceRanges | null;
  priceRangesError: string | null;
  boardMeeting: BoardMeetingInfo | null;
  boardMeetingError: string | null;
};

export type ScreenMeta = {
  underlyings: string[];
  expiriesByUnderlying: Record<string, string[]>;
};

export type InvestmentReportProgress = {
  status: "idle" | "running" | "cancelled" | "completed";
  expiryIso: string;
  eligible: number;
  skipped: number;
  processed: number;
  failed: number;
  qualifyingCount: number;
  currentSymbol: string | null;
};

export type InvestmentReportRow = ScreenCandidate & {
  spot: number;
};
