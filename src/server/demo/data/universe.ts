import type { AccountId } from "@/config/accounts";
import type { RawPosition } from "@/server/kotak/positions";
import type { InstrumentQuote } from "@/server/kotak/quotes";
import type { ScripInstrument } from "@/server/kotak/scrip-master";
import type { SpanContract, SpanUnderlying } from "@/server/span/types";

export type DemoUnderlyingSpec = {
  symbol: string;
  name: string;
  spot: number;
  lotSize: number;
  strikeStep: number;
  cashToken: string;
  yearHigh: number;
  yearLow: number;
  strikeCountEachSide: number;
};

export type DemoExpiry = {
  iso: string;
  label: string;
  trd: string;
  expiryKey: string;
};

export type DemoOptionInstrument = {
  underlying: string;
  exchangeSegment: "nse_fo";
  instrumentToken: string;
  tradingSymbol: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expiry: DemoExpiry;
  lotSize: number;
};

export type DemoCashInstrument = {
  underlying: string;
  name: string;
  exchangeSegment: "nse_cm";
  instrumentToken: string;
  tradingSymbol: string;
  spot: number;
  yearHigh: number;
  yearLow: number;
};

export type DemoUniverse = {
  asOfDate: string;
  expiries: DemoExpiry[];
  cash: DemoCashInstrument[];
  options: DemoOptionInstrument[];
  quotesByKey: Map<string, InstrumentQuote>;
  positionsByAccount: Record<AccountId, RawPosition[]>;
  scripInstruments: ScripInstrument[];
  spanUnderlyings: Map<string, SpanUnderlying>;
};

const UNDERLYINGS: DemoUnderlyingSpec[] = [
  {
    symbol: "SBIN",
    name: "STATE BANK OF INDIA",
    spot: 870,
    lotSize: 150,
    strikeStep: 10,
    cashToken: "3045",
    yearHigh: 920,
    yearLow: 680,
    strikeCountEachSide: 8,
  },
  {
    symbol: "ASHOKLEY",
    name: "ASHOK LEYLAND LIMITED",
    spot: 185,
    lotSize: 1000,
    strikeStep: 2.5,
    cashToken: "10604",
    yearHigh: 220,
    yearLow: 140,
    strikeCountEachSide: 8,
  },
  {
    symbol: "BOSCHLTD",
    name: "BOSCH LIMITED",
    spot: 45200,
    lotSize: 15,
    strikeStep: 500,
    cashToken: "2181",
    yearHigh: 48000,
    yearLow: 30000,
    strikeCountEachSide: 6,
  },
  {
    symbol: "M&M",
    name: "MAHINDRA & MAHINDRA LIMITED",
    spot: 3000,
    lotSize: 50,
    strikeStep: 50,
    cashToken: "11915",
    yearHigh: 3400,
    yearLow: 2400,
    strikeCountEachSide: 6,
  },
];

const MONTH_TRD = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toIso(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function toExpiry(date: Date): DemoExpiry {
  const day = date.getUTCDate();
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const iso = toIso(date);
  return {
    iso,
    label: `${pad2(day)}-${MONTH_LABEL[month]}-${year}`,
    trd: `${pad2(day)}${MONTH_TRD[month]}${String(year).slice(-2)}`,
    expiryKey: iso.replaceAll("-", ""),
  };
}

/** Last Thursday (UTC calendar) of the given year/month. */
function lastThursday(year: number, monthIndex: number): Date {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (date.getUTCDay() !== 4) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

function demoExpiries(now = new Date()): DemoExpiry[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const current = lastThursday(year, month);
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const next = lastThursday(nextYear, nextMonth);
  return [toExpiry(current), toExpiry(next)];
}

function roundStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

function strikeTokenPart(strike: number): string {
  if (Number.isInteger(strike)) {
    return String(strike);
  }
  return String(strike).replace(".", "");
}

function optionPremium(
  spot: number,
  strike: number,
  optionType: "CALL" | "PUT",
): number {
  const intrinsic =
    optionType === "CALL" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const otm = Math.abs(spot - strike);
  const timeValue = Math.max(spot * 0.008, stepGuess(spot) * 0.35) * Math.exp(-otm / (spot * 0.12));
  return Math.max(0.05, Number((intrinsic + timeValue).toFixed(2)));
}

function stepGuess(spot: number): number {
  if (spot > 10000) return 500;
  if (spot > 500) return 10;
  return 2.5;
}

function quoteKey(segment: string, token: string): string {
  return `${segment}:${token}`;
}

function makeRiskArray(base: number): number[] {
  return [
    base,
    base,
    base * 0.5,
    base * 0.5,
    -base,
    -base,
    base * 1.5,
    base * 1.5,
    -base * 1.2,
    -base * 1.2,
    base * 2,
    base * 2,
    -base * 1.8,
    -base * 1.8,
    base * 0.8,
    -base * 0.8,
  ];
}

function buildOptionInstrument(
  underlying: DemoUnderlyingSpec,
  expiry: DemoExpiry,
  strike: number,
  optionType: "CALL" | "PUT",
  token: number,
): DemoOptionInstrument {
  const suffix = optionType === "CALL" ? "CE" : "PE";
  return {
    underlying: underlying.symbol,
    exchangeSegment: "nse_fo",
    instrumentToken: String(token),
    tradingSymbol: `${underlying.symbol}${expiry.trd}${strikeTokenPart(strike)}${suffix}`,
    optionType,
    strike,
    expiry,
    lotSize: underlying.lotSize,
  };
}

let cached: DemoUniverse | null = null;

export function getDemoUniverse(now = new Date()): DemoUniverse {
  if (cached) {
    return cached;
  }

  const asOfDate = toIso(now);
  const expiries = demoExpiries(now);
  const cash: DemoCashInstrument[] = [];
  const options: DemoOptionInstrument[] = [];
  const quotesByKey = new Map<string, InstrumentQuote>();
  const scripInstruments: ScripInstrument[] = [];
  const spanUnderlyings = new Map<string, SpanUnderlying>();
  let nextToken = 900_000;

  for (const underlying of UNDERLYINGS) {
    cash.push({
      underlying: underlying.symbol,
      name: underlying.name,
      exchangeSegment: "nse_cm",
      instrumentToken: underlying.cashToken,
      tradingSymbol: `${underlying.symbol}-EQ`,
      spot: underlying.spot,
      yearHigh: underlying.yearHigh,
      yearLow: underlying.yearLow,
    });

    scripInstruments.push({
      exchangeSegment: "nse_cm",
      instrumentToken: underlying.cashToken,
      tradingSymbol: `${underlying.symbol}-EQ`,
      underlying: underlying.symbol,
      name: underlying.name,
      instrumentType: "EQ",
      optionType: null,
      strike: null,
      expiryIso: null,
      lotSize: 1,
      multiplier: 1,
    });

    quotesByKey.set(quoteKey("nse_cm", underlying.cashToken), {
      instrumentToken: underlying.cashToken,
      exchangeSegment: "nse_cm",
      tradingSymbol: `${underlying.symbol}-EQ`,
      ltp: underlying.spot,
      ltpSource: "ltp",
      bestBid: underlying.spot - underlying.strikeStep * 0.1,
      bestAsk: underlying.spot + underlying.strikeStep * 0.1,
      buyDepth: [
        {
          price: underlying.spot - underlying.strikeStep * 0.1,
          quantity: underlying.lotSize * 4,
          orders: 2,
        },
      ],
    });

    const atm = roundStrike(underlying.spot, underlying.strikeStep);
    const strikes: number[] = [];
    for (let i = -underlying.strikeCountEachSide; i <= underlying.strikeCountEachSide; i += 1) {
      strikes.push(Number((atm + i * underlying.strikeStep).toFixed(4)));
    }

    const spanContracts: SpanContract[] = [];

    for (const expiry of expiries) {
      for (const strike of strikes) {
        for (const optionType of ["CALL", "PUT"] as const) {
          const token = nextToken;
          nextToken += 1;
          const instrument = buildOptionInstrument(
            underlying,
            expiry,
            strike,
            optionType,
            token,
          );
          options.push(instrument);

          const premium = optionPremium(underlying.spot, strike, optionType);
          const bestBid = Number((premium * 0.97).toFixed(2));
          const bestAsk = Number((premium * 1.03).toFixed(2));
          quotesByKey.set(quoteKey("nse_fo", instrument.instrumentToken), {
            instrumentToken: instrument.instrumentToken,
            exchangeSegment: "nse_fo",
            tradingSymbol: instrument.tradingSymbol,
            ltp: premium,
            ltpSource: "ltp",
            bestBid,
            bestAsk,
            buyDepth: [
              { price: bestBid, quantity: underlying.lotSize * 3, orders: 3 },
              {
                price: Number((bestBid * 0.98).toFixed(2)),
                quantity: underlying.lotSize * 2,
                orders: 2,
              },
              {
                price: Number((bestBid * 0.96).toFixed(2)),
                quantity: underlying.lotSize * 5,
                orders: 4,
              },
            ],
          });

          scripInstruments.push({
            exchangeSegment: "nse_fo",
            instrumentToken: instrument.instrumentToken,
            tradingSymbol: instrument.tradingSymbol,
            underlying: underlying.symbol,
            name: underlying.name,
            instrumentType: "OPTSTK",
            optionType,
            strike,
            expiryIso: expiry.iso,
            lotSize: underlying.lotSize,
            multiplier: 1,
          });

          const riskBase = Math.max(1, premium * 0.4);
          spanContracts.push({
            instrumentType: "OPT",
            optionType: optionType === "CALL" ? "C" : "P",
            expiry: expiry.expiryKey,
            strike,
            price: premium,
            cvf: 1,
            riskArray: makeRiskArray(riskBase),
            compositeDelta: optionType === "CALL" ? 0.45 : -0.45,
          });
        }
      }
    }

    spanUnderlyings.set(underlying.symbol, {
      symbol: underlying.symbol,
      spot: underlying.spot,
      somRate: 0,
      contracts: spanContracts,
      spreads: [],
    });
  }

  const findOption = (
    symbol: string,
    expiryIndex: number,
    optionType: "CALL" | "PUT",
    strikeOffsetSteps: number,
  ): DemoOptionInstrument => {
    const underlying = UNDERLYINGS.find((item) => item.symbol === symbol);
    if (!underlying) {
      throw new Error(`Unknown demo underlying ${symbol}`);
    }
    const expiry = expiries[expiryIndex];
    const atm = roundStrike(underlying.spot, underlying.strikeStep);
    const strike = Number(
      (atm + strikeOffsetSteps * underlying.strikeStep).toFixed(4),
    );
    const match = options.find(
      (item) =>
        item.underlying === symbol &&
        item.expiry.iso === expiry.iso &&
        item.optionType === optionType &&
        item.strike === strike,
    );
    if (!match) {
      throw new Error(
        `Missing demo option ${symbol} ${optionType} ${strike} ${expiry.iso}`,
      );
    }
    return match;
  };

  const toRawPosition = (
    instrument: DemoOptionInstrument,
    netQty: number,
  ): RawPosition => ({
    tok: instrument.instrumentToken,
    trdSym: instrument.tradingSymbol,
    sym: instrument.underlying,
    exSeg: instrument.exchangeSegment,
    optTp: instrument.optionType === "CALL" ? "CE" : "PE",
    stkPrc: String(instrument.strike),
    expDt: instrument.expiry.label,
    exp: instrument.expiry.label,
    lotSz: String(instrument.lotSize),
    multiplier: "1",
    precision: "2",
    prod: "NRML",
    it: "OPTSTK",
    cfBuyQty: "0",
    flBuyQty: "0",
    cfSellQty: netQty < 0 ? String(Math.abs(netQty)) : "0",
    flSellQty: "0",
    qty: String(netQty),
  });

  const positionsByAccount: Record<AccountId, RawPosition[]> = {
    prakash: [
      toRawPosition(findOption("SBIN", 0, "CALL", 3), -150),
      toRawPosition(findOption("SBIN", 0, "PUT", -2), -150),
      toRawPosition(findOption("M&M", 0, "CALL", 2), -50),
    ],
    gopa: [
      toRawPosition(findOption("ASHOKLEY", 0, "CALL", 4), -1000),
      toRawPosition(findOption("ASHOKLEY", 0, "PUT", -3), -1000),
      toRawPosition(findOption("SBIN", 1, "CALL", 5), -150),
    ],
    huf: [
      toRawPosition(findOption("BOSCHLTD", 0, "CALL", 2), -15),
      toRawPosition(findOption("BOSCHLTD", 0, "PUT", -2), -15),
      toRawPosition(findOption("ASHOKLEY", 1, "CALL", 6), -1000),
    ],
  };

  cached = {
    asOfDate,
    expiries,
    cash,
    options,
    quotesByKey,
    positionsByAccount,
    scripInstruments,
    spanUnderlyings,
  };
  return cached;
}

export function resetDemoUniverseForTests(): void {
  cached = null;
}

export function demoUnderlyingSpecs(): readonly DemoUnderlyingSpec[] {
  return UNDERLYINGS;
}
