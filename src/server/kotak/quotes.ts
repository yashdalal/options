import { z } from "zod";
import { kotakFetch } from "./client";
import { KotakApiError } from "./errors";
import type { TradeSessionCredentials } from "./auth";
import { logWarn } from "../logging";
import { getKotakRateLimiter } from "./rate-limit";

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
    ohlc: z
      .object({
        open: z.union([z.string(), z.number()]).optional(),
        high: z.union([z.string(), z.number()]).optional(),
        low: z.union([z.string(), z.number()]).optional(),
        close: z.union([z.string(), z.number()]).optional(),
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

export type InstrumentQuote = {
  instrumentToken: string;
  exchangeSegment: string;
  tradingSymbol?: string;
  ltp: number | null;
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

function resolveLtp(item: z.infer<typeof quoteItemSchema>): number | null {
  return (
    toNumber(item.ltp) ??
    toNumber(item.last_traded_price) ??
    toNumber(item.ohlc?.close)
  );
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

function toQuoteToken(instrumentToken: string): string {
  return instrumentToken === "26000" ? "Nifty 50" : instrumentToken;
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

  const limiter = getKotakRateLimiter();
  const payload = await limiter.schedule(() =>
    kotakFetch(
      `${session.baseUrl}/script-details/1.0/quotes/neosymbol/${encodeURIComponent(neoSymbols)}`,
      {
        method: "GET",
        headers: {
          Authorization: session.accessToken,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    ),
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
    });
  }
  return results;
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
        results.push({
          instrumentToken: item.instrumentToken,
          exchangeSegment: item.exchangeSegment,
          ltp: null,
        });
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
