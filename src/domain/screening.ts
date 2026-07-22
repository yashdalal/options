import type { OptionType, ScreenCandidate, ScreenSideFilter } from "./types";

export type ScreenableOption = {
  optionType: OptionType;
  strike: number;
  lotSize: number;
  instrumentToken: string;
  exchangeSegment: string;
  tradingSymbol: string;
  expiryIso: string;
};

function istTodayUtc(now = new Date()): number {
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const todayYear = Number(todayParts.find((part) => part.type === "year")?.value);
  const todayMonth = Number(todayParts.find((part) => part.type === "month")?.value);
  const todayDay = Number(todayParts.find((part) => part.type === "day")?.value);
  return Date.UTC(todayYear, todayMonth - 1, todayDay);
}

function expiryUtcFromIso(expiryIso: string): number | null {
  const [year, month, day] = expiryIso.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
}

export function calendarDaysLeft(expiryIso: string, now = new Date()): number {
  const expiryUtc = expiryUtcFromIso(expiryIso);
  if (expiryUtc === null) {
    return 0;
  }
  const todayUtc = istTodayUtc(now);
  const diffDays = Math.ceil((expiryUtc - todayUtc) / 86_400_000);
  return Math.max(diffDays, 1);
}

export function workingDaysLeft(expiryIso: string, now = new Date()): number {
  const expiryUtc = expiryUtcFromIso(expiryIso);
  if (expiryUtc === null) {
    return 0;
  }
  const todayUtc = istTodayUtc(now);
  if (expiryUtc <= todayUtc) {
    return 1;
  }
  let count = 0;
  for (let dayMs = todayUtc + 86_400_000; dayMs <= expiryUtc; dayMs += 86_400_000) {
    const dayOfWeek = new Date(dayMs).getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count += 1;
    }
  }
  return Math.max(count, 1);
}

export function calculateSpreadPct(
  optionType: OptionType,
  strike: number,
  spot: number,
): number | null {
  if (!(spot > 0) || !(strike > 0)) {
    return null;
  }
  if (optionType === "CALL") {
    if (!(strike > spot)) {
      return null;
    }
    return ((strike - spot) / spot) * 100;
  }
  if (!(strike < spot)) {
    return null;
  }
  return ((spot - strike) / spot) * 100;
}

export const OPTION_SELL_CHARGES = {
  brokeragePerOrderInr: 10,
  sttRate: 0.0015,
  exchangeTxnRate: 0.0003503,
  sebiRate: 0.000001,
  gstRate: 0.18,
} as const;

export function calculateOptionSellExpenses(
  premium: number,
  lotSize: number,
  lots: number,
): number {
  const turnover = premium * lotSize * lots;
  if (!(turnover > 0)) {
    return 0;
  }
  const brokerage = OPTION_SELL_CHARGES.brokeragePerOrderInr;
  const stt = turnover * OPTION_SELL_CHARGES.sttRate;
  const exchange = turnover * OPTION_SELL_CHARGES.exchangeTxnRate;
  const sebi = turnover * OPTION_SELL_CHARGES.sebiRate;
  const gst = OPTION_SELL_CHARGES.gstRate * (brokerage + exchange + sebi);
  return brokerage + stt + exchange + sebi + gst;
}

export function calculateNetPremium(
  premium: number,
  lotSize: number,
  lots: number,
): number {
  return premium * lotSize * lots - calculateOptionSellExpenses(premium, lotSize, lots);
}

export type BidDepthLevel = {
  price: number;
  quantity: number;
};

export type BidFill = {
  premium: number;
  lots: number;
};

export function allocateLotsAcrossBids(
  buyDepth: BidDepthLevel[],
  lotSize: number,
  requestedLots: number,
): BidFill[] {
  if (!(lotSize > 0) || !(requestedLots > 0)) {
    return [];
  }
  const fills: BidFill[] = [];
  let remaining = requestedLots;
  for (const level of buyDepth) {
    if (remaining <= 0) {
      break;
    }
    if (!(level.price > 0) || !(level.quantity > 0)) {
      continue;
    }
    const availableLots = Math.floor(level.quantity / lotSize);
    if (availableLots <= 0) {
      continue;
    }
    const take = Math.min(remaining, availableLots);
    fills.push({ premium: level.price, lots: take });
    remaining -= take;
  }
  return fills;
}

export function calculateAnnualizedReturnPct(
  netPremium: number,
  margin: number,
  daysLeft: number,
): number | null {
  if (!(margin > 0) || !(daysLeft > 0)) {
    return null;
  }
  return (netPremium / margin) * (365 / daysLeft) * 100;
}

export function matchesSideFilter(
  optionType: OptionType,
  side: ScreenSideFilter,
): boolean {
  if (side === "BOTH") {
    return true;
  }
  return optionType === side;
}

export type SpreadSelection = {
  options: ScreenableOption[];
  maxPerSide: number;
  nearBandCalls: number;
  nearBandPuts: number;
  selectedCalls: number;
  selectedPuts: number;
};

export function selectOtmOptionsNearSpread(input: {
  options: ScreenableOption[];
  spot: number;
  spreadMin: number;
  side: ScreenSideFilter;
  bufferPct?: number;
  maxPerSide?: number;
}): SpreadSelection {
  const bufferPct = input.bufferPct ?? 8;
  const maxPerSide = input.maxPerSide ?? 50;
  const low = input.spreadMin - bufferPct;

  const scored = input.options
    .filter((option) => matchesSideFilter(option.optionType, input.side))
    .map((option) => {
      const spreadPct = calculateSpreadPct(option.optionType, option.strike, input.spot);
      return spreadPct === null ? null : { option, spreadPct };
    })
    .filter((item): item is { option: ScreenableOption; spreadPct: number } => item !== null)
    .filter((item) => item.spreadPct >= low)
    .sort((left, right) => left.spreadPct - right.spreadPct);

  const nearBandCalls = scored.filter((item) => item.option.optionType === "CALL").length;
  const nearBandPuts = scored.filter((item) => item.option.optionType === "PUT").length;

  const calls: ScreenableOption[] = [];
  const puts: ScreenableOption[] = [];
  for (const item of scored) {
    if (item.option.optionType === "CALL" && calls.length < maxPerSide) {
      calls.push(item.option);
    }
    if (item.option.optionType === "PUT" && puts.length < maxPerSide) {
      puts.push(item.option);
    }
  }
  return {
    options: [...calls, ...puts],
    maxPerSide,
    nearBandCalls,
    nearBandPuts,
    selectedCalls: calls.length,
    selectedPuts: puts.length,
  };
}

export function buildScreenCandidate(input: {
  company: string;
  option: ScreenableOption;
  spot: number;
  premium: number | null;
  lots: number;
  daysLeft: number;
  spreadMin: number;
  returnMin: number;
  fillIndex?: number;
  margin?: number | null;
}): ScreenCandidate {
  const fillIndex = input.fillIndex ?? 0;
  const spreadPct =
    calculateSpreadPct(input.option.optionType, input.option.strike, input.spot) ?? 0;
  const hasBid = input.premium !== null && input.premium > 0;
  const premium = hasBid ? input.premium : null;
  const netPremium =
    premium === null ? null : calculateNetPremium(premium, input.option.lotSize, input.lots);
  const margin = input.margin ?? null;
  const annualizedReturnPct =
    !hasBid || margin === null || netPremium === null
      ? null
      : calculateAnnualizedReturnPct(netPremium, margin, input.daysLeft);
  const meetsSpread = spreadPct >= input.spreadMin;
  const meetsReturn =
    annualizedReturnPct === null ? null : annualizedReturnPct >= input.returnMin;

  return {
    id: `${input.option.instrumentToken}:${fillIndex}`,
    company: input.company,
    optionType: input.option.optionType,
    strike: input.option.strike,
    spot: input.spot,
    spreadPct,
    priceDiffInr: Math.abs(input.option.strike - input.spot),
    premium,
    hasBid,
    lotSize: input.option.lotSize,
    lots: input.lots,
    fillIndex,
    netPremium,
    calendarDaysLeft: input.daysLeft,
    expiryIso: input.option.expiryIso,
    instrumentToken: input.option.instrumentToken,
    exchangeSegment: input.option.exchangeSegment,
    tradingSymbol: input.option.tradingSymbol,
    margin,
    annualizedReturnPct,
    meetsSpread,
    meetsReturn,
  };
}
