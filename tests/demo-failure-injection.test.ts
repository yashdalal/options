import { afterEach, describe, expect, it } from "vitest";
import { demoFetchQuotes } from "@/server/demo/adapters/quotes";
import { getDemoUniverse, resetDemoUniverseForTests } from "@/server/demo/data/universe";
import type { TradeSessionCredentials } from "@/server/kotak/auth";

const session = {} as TradeSessionCredentials;

function optionRefs(symbol: string) {
  return getDemoUniverse()
    .options.filter((option) => option.underlying === symbol)
    .slice(0, 3)
    .map((option) => ({
      instrumentToken: option.instrumentToken,
      exchangeSegment: option.exchangeSegment,
    }));
}

afterEach(() => {
  delete process.env.DEMO_FAIL_OPTION_QUOTES;
  resetDemoUniverseForTests();
});

describe("DEMO_FAIL_OPTION_QUOTES", () => {
  it("fails option quotes only for the listed symbols", async () => {
    process.env.DEMO_FAIL_OPTION_QUOTES = "boschltd";

    await expect(demoFetchQuotes(session, optionRefs("BOSCHLTD"))).rejects.toThrow(
      /Demo quote failure for BOSCHLTD/,
    );
    await expect(demoFetchQuotes(session, optionRefs("SBIN"))).resolves.toHaveLength(3);
  });

  it("leaves spot quotes working for a failing symbol", async () => {
    process.env.DEMO_FAIL_OPTION_QUOTES = "BOSCHLTD";
    const cash = getDemoUniverse().cash.find((item) => item.underlying === "BOSCHLTD")!;

    const quotes = await demoFetchQuotes(session, [
      { instrumentToken: cash.instrumentToken, exchangeSegment: cash.exchangeSegment },
    ]);
    expect(quotes[0]?.ltp).toBe(cash.spot);
  });

  it("does nothing when unset", async () => {
    await expect(demoFetchQuotes(session, optionRefs("BOSCHLTD"))).resolves.toHaveLength(3);
  });
});
