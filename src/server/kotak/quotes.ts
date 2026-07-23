import { z } from "zod";
import { kotakFetch } from "./client";
import { KotakApiError } from "./errors";
import type { TradeSessionCredentials } from "./auth";
import { logWarn } from "../logging";
import { getKotakRateLimiter } from "./rate-limit";

const depthLevelSchema = z
  .object({
    price: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    orders: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const quoteItemSchema = z
  .object({
    instrument_token: z.union([z.string(), z.number()]).optional(),
    exchange_token: z.union([z.string(), z.number()]).optional(),
    pSymbol: z.union([z.string(), z.number()]).optional(),
    exchange_segment: z.string().optional(),
    exchange: z.string().optional(),
    trading_symbol: z.string().optional(),
    display_symbol: z.string().optional(),
    last_traded_price: z.union([z.string(), z.number()]).optional(),
    ltp: z.union([z.string(), z.number()]).optional(),
    buy_price: z.union([z.string(), z.number()]).optional(),
    sell_price: z.union([z.string(), z.number()]).optional(),
    "52week_high": z.union([z.string(), z.number()]).optional(),
    "52week_low": z.union([z.string(), z.number()]).optional(),
    year_high: z.union([z.string(), z.number()]).optional(),
    year_low: z.union([z.string(), z.number()]).optional(),
    week_52_high: z.union([z.string(), z.number()]).optional(),
    week_52_low: z.union([z.string(), z.number()]).optional(),
    high_52_week: z.union([z.string(), z.number()]).optional(),
    low_52_week: z.union([z.string(), z.number()]).optional(),
    yh: z.union([z.string(), z.number()]).optional(),
    yl: z.union([z.string(), z.number()]).optional(),
    ohlc: z
      .object({
        open: z.union([z.string(), z.number()]).optional(),
        high: z.union([z.string(), z.number()]).optional(),
        low: z.union([z.string(), z.number()]).optional(),
        close: z.union([z.string(), z.number()]).optional(),
      })
      .optional(),
    depth: z
      .object({
        buy: z.array(depthLevelSchema).optional(),
        sell: z.array(depthLevelSchema).optional(),
      })
      .optional(),
  })
  .passthrough();

const quotesResponseSchema = z.union([
  z.object({
    message: z.array(quoteItemSchema).optional(),
    data: z.array(quoteItemSchema).optional(),
  }),
  z.array(quoteItemSchema),
]);

export type InstrumentRef = {
  instrumentToken: string;
  exchangeSegment: string;
};

export type QuoteDepthLevel = {
  price: number;
  quantity: number;
  orders: number;
};

export type InstrumentQuote = {
  instrumentToken: string;
  exchangeSegment: string;
  tradingSymbol?: string;
  ltp: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  buyDepth: QuoteDepthLevel[];
};

export type SpotQuote = {
  instrumentToken: string;
  exchangeSegment: string;
  tradingSymbol?: string;
  spot: number | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstPositiveDepthPrice(
  levels: z.infer<typeof depthLevelSchema>[] | undefined,
): number | null {
  if (!levels) {
    return null;
  }
  for (const level of levels) {
    const price = toNumber(level.price);
    if (price !== null && price > 0) {
      return price;
    }
  }
  return null;
}

export function parseBuyDepth(
  levels: z.infer<typeof depthLevelSchema>[] | undefined,
): QuoteDepthLevel[] {
  if (!levels) {
    return [];
  }
  const parsed: QuoteDepthLevel[] = [];
  for (const level of levels) {
    const price = toNumber(level.price);
    const quantity = toNumber(level.quantity);
    if (price === null || !(price > 0) || quantity === null || !(quantity > 0)) {
      continue;
    }
    parsed.push({
      price,
      quantity,
      orders: toNumber(level.orders) ?? 0,
    });
  }
  return parsed;
}

function resolveLtp(item: z.infer<typeof quoteItemSchema>): number | null {
  return (
    toNumber(item.ltp) ??
    toNumber(item.last_traded_price) ??
    toNumber(item.ohlc?.close)
  );
}

export function resolveBestBid(item: z.infer<typeof quoteItemSchema>): number | null {
  return firstPositiveDepthPrice(item.depth?.buy) ?? toNumber(item.buy_price);
}

export function resolveBestAsk(item: z.infer<typeof quoteItemSchema>): number | null {
  return firstPositiveDepthPrice(item.depth?.sell) ?? toNumber(item.sell_price);
}

export function resolveYearHigh(item: z.infer<typeof quoteItemSchema>): number | null {
  const value =
    toNumber(item.year_high) ??
    toNumber(item["52week_high"]) ??
    toNumber(item.week_52_high) ??
    toNumber(item.high_52_week) ??
    toNumber(item.yh);
  return value !== null && value > 0 ? value : null;
}

export function resolveYearLow(item: z.infer<typeof quoteItemSchema>): number | null {
  const value =
    toNumber(item.year_low) ??
    toNumber(item["52week_low"]) ??
    toNumber(item.week_52_low) ??
    toNumber(item.low_52_week) ??
    toNumber(item.yl);
  return value !== null && value > 0 ? value : null;
}

function extractItems(payload: unknown): z.infer<typeof quoteItemSchema>[] {
  const parsed = quotesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return parsed.data.message ?? parsed.data.data ?? [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

/** Kotak quotes use index names, not scrip-master pSymbol, for cash indexes. */
const INDEX_QUOTE_TOKENS: Record<string, string> = {
  "26000": "Nifty 50",
  "26009": "Nifty Bank",
  "26037": "Nifty Fin Service",
  "26074": "NIFTY MID SELECT",
  "1": "SENSEX",
  "12": "BANKEX",
  "47": "SENSEX50",
};

export function toQuoteToken(instrumentToken: string): string {
  return INDEX_QUOTE_TOKENS[instrumentToken] ?? instrumentToken;
}

async function fetchQuoteBatch(
  session: TradeSessionCredentials,
  batch: InstrumentRef[],
): Promise<InstrumentQuote[]> {
  const requestedByQuoteKey = new Map(
    batch.map((item) => [
      `${item.exchangeSegment}:${toQuoteToken(item.instrumentToken)}`,
      item,
    ]),
  );
  const neoSymbols = batch
    .map((item) => `${item.exchangeSegment}|${toQuoteToken(item.instrumentToken)}`)
    .join(",");

  const quotePath = `${session.baseUrl}/script-details/1.0/quotes/neosymbol/${encodeURIComponent(neoSymbols)}`;

  const limiter = getKotakRateLimiter();
  const payload = await limiter.schedule(() =>
    kotakFetch(quotePath, {
      method: "GET",
      headers: {
        Authorization: session.accessToken,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }),
  );

  const results: InstrumentQuote[] = [];
  const items = extractItems(payload);
  for (const item of items) {
    const quoteToken = String(
      item.instrument_token ?? item.exchange_token ?? item.pSymbol ?? "",
    );
    const segment = String(item.exchange_segment ?? item.exchange ?? "nse_cm");
    const requested = requestedByQuoteKey.get(`${segment}:${quoteToken}`);
    results.push({
      instrumentToken: requested?.instrumentToken ?? quoteToken,
      exchangeSegment: segment,
      tradingSymbol: item.trading_symbol ?? item.display_symbol,
      ltp: resolveLtp(item),
      bestBid: resolveBestBid(item),
      bestAsk: resolveBestAsk(item),
      buyDepth: parseBuyDepth(item.depth?.buy),
    });
  }
  return results;
}

function emptyQuote(item: InstrumentRef): InstrumentQuote {
  return {
    instrumentToken: item.instrumentToken,
    exchangeSegment: item.exchangeSegment,
    ltp: null,
    bestBid: null,
    bestAsk: null,
    buyDepth: [],
  };
}

export async function fetchQuotes(
  session: TradeSessionCredentials,
  instruments: InstrumentRef[],
  batchSize = 50,
): Promise<InstrumentQuote[]> {
  const unique = new Map<string, InstrumentRef>();
  for (const item of instruments) {
    unique.set(`${item.exchangeSegment}:${item.instrumentToken}`, item);
  }

  const results: InstrumentQuote[] = [];

  for (const batch of chunk([...unique.values()], batchSize)) {
    try {
      const batchResults = await fetchQuoteBatch(session, batch);
      results.push(...batchResults);
    } catch (error) {
      logWarn("Quote batch failed", {
        size: batch.length,
        error: error instanceof Error ? error.message : "unknown",
      });
      for (const item of batch) {
        results.push(emptyQuote(item));
      }
    }
  }

  if (instruments.length > 0 && results.length === 0) {
    throw new KotakApiError("No quote data returned", 500, "invalid_response");
  }

  return results;
}

export async function fetchSpotQuotes(
  session: TradeSessionCredentials,
  instruments: InstrumentRef[],
  batchSize = 50,
): Promise<SpotQuote[]> {
  const quotes = await fetchQuotes(session, instruments, batchSize);
  return quotes.map((quote) => ({
    instrumentToken: quote.instrumentToken,
    exchangeSegment: quote.exchangeSegment,
    tradingSymbol: quote.tradingSymbol,
    spot: quote.ltp,
  }));
}
