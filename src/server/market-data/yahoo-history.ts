import { logWarn } from "../logging";

export type DailyBar = {
  date: string;
  high: number;
  low: number;
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

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const ONE_MONTH_BARS = 21;
const THREE_MONTH_BARS = 63;

type CacheEntry = {
  expiresAt: number;
  bars: DailyBar[];
  range: string;
};

const barsCache = new Map<string, CacheEntry>();
const YAHOO_HISTORY_RANGE = "1y";

export class YahooHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YahooHistoryError";
  }
}

const INDEX_YAHOO_SYMBOLS: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  FINNIFTY: "NIFTY_FIN_SERVICE.NS",
  MIDCPNIFTY: "NIFTY_MID_SELECT.NS",
};

export function toYahooSymbol(nseSymbol: string): string {
  const cleaned = nseSymbol.trim().toUpperCase().replace(/-EQ$/i, "");
  return INDEX_YAHOO_SYMBOLS[cleaned] ?? `${cleaned}.NS`;
}

export function computeRange(bars: DailyBar[], lookbackBars: number): PriceBand {
  if (bars.length === 0 || lookbackBars <= 0) {
    return { high: null, low: null };
  }
  const window = bars.slice(-lookbackBars);
  let high = -Infinity;
  let low = Infinity;
  for (const bar of window) {
    if (bar.high > high) {
      high = bar.high;
    }
    if (bar.low < low) {
      low = bar.low;
    }
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return { high: null, low: null };
  }
  return { high, low };
}

export function emptyPriceRanges(
  oneYear: PriceBand = { high: null, low: null },
): UnderlyingPriceRanges {
  return {
    oneMonth: { high: null, low: null },
    threeMonth: { high: null, low: null },
    oneYear,
  };
}

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          high?: Array<number | null>;
          low?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

export function parseYahooChartPayload(payload: unknown): DailyBar[] {
  const chart = (payload as YahooChartResponse)?.chart;
  if (chart?.error?.description) {
    throw new YahooHistoryError(`Yahoo chart error: ${chart.error.description}`);
  }
  const result = chart?.result?.[0];
  if (!result) {
    throw new YahooHistoryError("Yahoo chart returned no result");
  }
  const timestamps = result.timestamp ?? [];
  const highs = result.indicators?.quote?.[0]?.high ?? [];
  const lows = result.indicators?.quote?.[0]?.low ?? [];
  const bars: DailyBar[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const high = highs[index];
    const low = lows[index];
    if (
      typeof high !== "number" ||
      typeof low !== "number" ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      high <= 0 ||
      low <= 0
    ) {
      continue;
    }
    const date = new Date(timestamps[index] * 1000).toISOString().slice(0, 10);
    bars.push({ date, high, low });
  }
  if (bars.length === 0) {
    throw new YahooHistoryError("Yahoo chart returned no usable daily bars");
  }
  return bars;
}

export async function fetchDailyBars(nseSymbol: string): Promise<DailyBar[]> {
  const yahooSymbol = toYahooSymbol(nseSymbol);
  const cached = barsCache.get(yahooSymbol);
  if (cached && cached.expiresAt > Date.now() && cached.range === YAHOO_HISTORY_RANGE) {
    return cached.bars;
  }

  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", YAHOO_HISTORY_RANGE);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logWarn("Yahoo chart request errored", { symbol: yahooSymbol, error: message });
    throw new YahooHistoryError(`Yahoo chart request failed for ${yahooSymbol}: ${message}`);
  }

  if (!response.ok) {
    logWarn("Yahoo chart request failed", {
      symbol: yahooSymbol,
      status: response.status,
    });
    throw new YahooHistoryError(
      `Yahoo chart request failed for ${yahooSymbol} (HTTP ${response.status})`,
    );
  }

  const payload = (await response.json()) as unknown;
  const bars = parseYahooChartPayload(payload);
  barsCache.set(yahooSymbol, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    bars,
    range: YAHOO_HISTORY_RANGE,
  });
  return bars;
}

export async function fetchUnderlyingPriceRanges(
  nseSymbol: string,
): Promise<UnderlyingPriceRanges> {
  const bars = await fetchDailyBars(nseSymbol);
  return {
    oneMonth: computeRange(bars, ONE_MONTH_BARS),
    threeMonth: computeRange(bars, THREE_MONTH_BARS),
    oneYear: computeRange(bars, bars.length),
  };
}

export function clearYahooHistoryCache(): void {
  barsCache.clear();
}
