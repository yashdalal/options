import type { TradeSessionCredentials } from "@/server/kotak/auth";
import type {
  InstrumentQuote,
  InstrumentRef,
  SpotQuote,
} from "@/server/kotak/quotes";
import { getDemoUniverse } from "@/server/demo/data/universe";
import { KotakApiError } from "@/server/kotak/errors";

export function demoFailingOptionQuoteSymbols(): Set<string> {
  return new Set(
    (process.env.DEMO_FAIL_OPTION_QUOTES ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean),
  );
}

function throwIfDemoOptionQuotesShouldFail(instruments: InstrumentRef[]): void {
  const failingSymbols = demoFailingOptionQuoteSymbols();
  if (failingSymbols.size === 0) {
    return;
  }
  const universe = getDemoUniverse();
  const requestedKeys = new Set(
    instruments.map((item) => `${item.exchangeSegment}:${item.instrumentToken}`),
  );
  const failingSymbol = universe.options.find(
    (option) =>
      failingSymbols.has(option.underlying.toUpperCase()) &&
      requestedKeys.has(`${option.exchangeSegment}:${option.instrumentToken}`),
  )?.underlying;
  if (failingSymbol) {
    throw new KotakApiError(
      `Demo quote failure for ${failingSymbol} option quotes (DEMO_FAIL_OPTION_QUOTES)`,
      502,
      "bad_request",
    );
  }
}

function emptyQuote(item: InstrumentRef): InstrumentQuote {
  return {
    instrumentToken: item.instrumentToken,
    exchangeSegment: item.exchangeSegment,
    ltp: null,
    ltpSource: null,
    bestBid: null,
    bestAsk: null,
    buyDepth: [],
  };
}

export async function demoFetchQuotes(
  _session: TradeSessionCredentials,
  instruments: InstrumentRef[],
  _batchSize = 50,
): Promise<InstrumentQuote[]> {
  throwIfDemoOptionQuotesShouldFail(instruments);
  const universe = getDemoUniverse();
  const unique = new Map<string, InstrumentRef>();
  for (const item of instruments) {
    unique.set(`${item.exchangeSegment}:${item.instrumentToken}`, item);
  }

  return [...unique.values()].map((item) => {
    const key = `${item.exchangeSegment}:${item.instrumentToken}`;
    return universe.quotesByKey.get(key) ?? emptyQuote(item);
  });
}

export async function demoFetchSpotQuotes(
  session: TradeSessionCredentials,
  instruments: InstrumentRef[],
  batchSize = 50,
): Promise<SpotQuote[]> {
  const quotes = await demoFetchQuotes(session, instruments, batchSize);
  return quotes.map((quote) => ({
    instrumentToken: quote.instrumentToken,
    exchangeSegment: quote.exchangeSegment,
    tradingSymbol: quote.tradingSymbol,
    spot: quote.ltp,
    spotFromPreviousClose: quote.ltpSource === "previous_close",
  }));
}
