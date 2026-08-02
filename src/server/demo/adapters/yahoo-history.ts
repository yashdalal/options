import type { UnderlyingPriceRanges } from "@/server/market-data/yahoo-history";
import { demoUnderlyingSpecs } from "@/server/demo/data/universe";

export async function demoFetchUnderlyingPriceRanges(
  nseSymbol: string,
): Promise<UnderlyingPriceRanges> {
  const symbol = nseSymbol.trim().toUpperCase().replace(/-EQ$/i, "");
  const underlying = demoUnderlyingSpecs().find((item) => item.symbol === symbol);
  if (!underlying) {
    return {
      oneMonth: { high: null, low: null },
      threeMonth: { high: null, low: null },
      oneYear: { high: null, low: null },
    };
  }

  const spot = underlying.spot;
  return {
    oneMonth: {
      high: Number((spot * 1.04).toFixed(2)),
      low: Number((spot * 0.96).toFixed(2)),
    },
    threeMonth: {
      high: Number((spot * 1.08).toFixed(2)),
      low: Number((spot * 0.9).toFixed(2)),
    },
    oneYear: {
      high: underlying.yearHigh,
      low: underlying.yearLow,
    },
  };
}
