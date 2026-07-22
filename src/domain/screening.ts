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

export function calendarDaysLeft(expiryIso: string, now = new Date()): number {
  const [year, month, day] = expiryIso.split("-").map(Number);
  if (!year || !month || !day) {
    return 0;
  }
  const expiryUtc = Date.UTC(year, month - 1, day);
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const todayYear = Number(todayParts.find((part) => part.type === "year")?.value);
  const todayMonth = Number(todayParts.find((part) => part.type === "month")?.value);
  const todayDay = Number(todayParts.find((part) => part.type === "day")?.value);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const diffDays = Math.ceil((expiryUtc - todayUtc) / 86_400_000);
  return Math.max(diffDays, 1);
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

export function calculateNetPremium(
  premium: number,
  lotSize: number,
  lots: number,
  expenses: number,
): number {
  return premium * lotSize * lots - expenses;
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

export function selectOtmOptionsNearSpread(input: {
  options: ScreenableOption[];
  spot: number;
  spreadMin: number;
  spreadMax: number;
  side: ScreenSideFilter;
  bufferPct?: number;
  maxPerSide?: number;
}): ScreenableOption[] {
  const bufferPct = input.bufferPct ?? 2;
  const maxPerSide = input.maxPerSide ?? 6;
  const low = input.spreadMin - bufferPct;
  const high = input.spreadMax + bufferPct;

  const scored = input.options
    .filter((option) => matchesSideFilter(option.optionType, input.side))
    .map((option) => {
      const spreadPct = calculateSpreadPct(option.optionType, option.strike, input.spot);
      return spreadPct === null ? null : { option, spreadPct };
    })
    .filter((item): item is { option: ScreenableOption; spreadPct: number } => item !== null)
    .filter((item) => item.spreadPct >= low && item.spreadPct <= high)
    .sort((left, right) => {
      const leftMid = Math.abs(left.spreadPct - (input.spreadMin + input.spreadMax) / 2);
      const rightMid = Math.abs(right.spreadPct - (input.spreadMin + input.spreadMax) / 2);
      return leftMid - rightMid;
    });

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
  return [...calls, ...puts];
}

export function buildScreenCandidate(input: {
  company: string;
  option: ScreenableOption;
  spot: number;
  premium: number;
  lots: number;
  expenses: number;
  daysLeft: number;
  spreadMin: number;
  spreadMax: number;
  returnMin: number;
  margin?: number | null;
}): ScreenCandidate {
  const spreadPct =
    calculateSpreadPct(input.option.optionType, input.option.strike, input.spot) ?? 0;
  const netPremium = calculateNetPremium(
    input.premium,
    input.option.lotSize,
    input.lots,
    input.expenses,
  );
  const margin = input.margin ?? null;
  const annualizedReturnPct =
    margin === null
      ? null
      : calculateAnnualizedReturnPct(netPremium, margin, input.daysLeft);
  const meetsSpread = spreadPct >= input.spreadMin && spreadPct <= input.spreadMax;
  const meetsReturn =
    annualizedReturnPct === null ? null : annualizedReturnPct >= input.returnMin;

  return {
    company: input.company,
    optionType: input.option.optionType,
    strike: input.option.strike,
    spot: input.spot,
    spreadPct,
    priceDiffInr: Math.abs(input.option.strike - input.spot),
    premium: input.premium,
    lotSize: input.option.lotSize,
    lots: input.lots,
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
