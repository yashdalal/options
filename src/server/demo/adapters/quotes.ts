import type { TradeSessionCredentials } from "@/server/kotak/auth";
import type {
  InstrumentQuote,
  InstrumentRef,
  SpotQuote,
} from "@/server/kotak/quotes";
import { getDemoUniverse } from "@/server/demo/data/universe";

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
