import { describe, expect, it } from "vitest";
import {
  computeRange,
  parseYahooChartPayload,
  toYahooSymbol,
} from "@/server/market-data/yahoo-history";

describe("toYahooSymbol", () => {
  it("maps NSE underlyings to Yahoo .NS tickers", () => {
    expect(toYahooSymbol("RELIANCE")).toBe("RELIANCE.NS");
    expect(toYahooSymbol("sbin-eq")).toBe("SBIN.NS");
    expect(toYahooSymbol("M&M")).toBe("M&M.NS");
  });

  it("maps index underlyings to Yahoo index tickers", () => {
    expect(toYahooSymbol("NIFTY")).toBe("^NSEI");
    expect(toYahooSymbol("BANKNIFTY")).toBe("^NSEBANK");
    expect(toYahooSymbol("SENSEX")).toBe("^BSESN");
  });
});

describe("computeRange", () => {
  const bars = [
    { date: "2026-01-01", high: 100, low: 90 },
    { date: "2026-01-02", high: 110, low: 95 },
    { date: "2026-01-03", high: 105, low: 88 },
    { date: "2026-01-04", high: 120, low: 100 },
  ];

  it("uses the last N bars for high/low", () => {
    expect(computeRange(bars, 2)).toEqual({ high: 120, low: 88 });
    expect(computeRange(bars, 21)).toEqual({ high: 120, low: 88 });
  });

  it("returns nulls for empty input", () => {
    expect(computeRange([], 21)).toEqual({ high: null, low: null });
    expect(computeRange(bars, 0)).toEqual({ high: null, low: null });
  });
});

describe("parseYahooChartPayload", () => {
  it("extracts daily high/low bars and skips nulls", () => {
    const bars = parseYahooChartPayload({
      chart: {
        result: [
          {
            timestamp: [1_700_000_000, 1_700_086_400, 1_700_172_800],
            indicators: {
              quote: [
                {
                  high: [100, null, 130],
                  low: [90, 95, 110],
                },
              ],
            },
          },
        ],
      },
    });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ high: 100, low: 90 });
    expect(bars[1]).toMatchObject({ high: 130, low: 110 });
  });

  it("returns empty for missing chart results", () => {
    expect(() => parseYahooChartPayload({})).toThrow(/no result/i);
    expect(() => parseYahooChartPayload({ chart: { result: [] } })).toThrow(
      /no result/i,
    );
  });

  it("throws when chart payload has no usable bars", () => {
    expect(() =>
      parseYahooChartPayload({
        chart: {
          result: [
            {
              timestamp: [1_700_000_000],
              indicators: { quote: [{ high: [null], low: [null] }] },
            },
          ],
        },
      }),
    ).toThrow(/no usable daily bars/i);
  });
});
