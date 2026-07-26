import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeSessionCredentials } from "@/server/kotak/auth";
import { KotakApiError } from "@/server/kotak/errors";

const { kotakFetch } = vi.hoisted(() => ({
  kotakFetch: vi.fn(),
}));

vi.mock("@/server/kotak/client", () => ({
  kotakFetch,
}));

vi.mock("@/server/kotak/rate-limit", () => ({
  getKotakRateLimiter: () => ({
    schedule: <T>(task: () => Promise<T>) => task(),
  }),
}));

import { fetchQuotes, resolveLtp } from "@/server/kotak/quotes";

const session: TradeSessionCredentials = {
  accessToken: "access",
  tradingToken: "trade",
  tradingSid: "sid",
  baseUrl: "https://example.kotaksecurities.com",
  neoFinKey: "neo",
};

describe("resolveLtp", () => {
  it("prefers session ltp over previous-day close", () => {
    expect(
      resolveLtp({
        ltp: 100,
        ohlc: { close: 95 },
      }),
    ).toEqual({ ltp: 100, source: "ltp" });
  });

  it("uses last_traded_price when ltp is missing", () => {
    expect(
      resolveLtp({
        last_traded_price: "101.5",
        ohlc: { close: 95 },
      }),
    ).toEqual({ ltp: 101.5, source: "ltp" });
  });

  it("falls back to previous-day close and marks the source", () => {
    expect(
      resolveLtp({
        ohlc: { close: 95 },
      }),
    ).toEqual({ ltp: 95, source: "previous_close" });
  });

  it("returns null when no price fields are present", () => {
    expect(resolveLtp({})).toEqual({ ltp: null, source: null });
  });
});

describe("fetchQuotes", () => {
  beforeEach(() => {
    kotakFetch.mockReset();
  });

  it("returns quotes for a successful batch", async () => {
    kotakFetch.mockResolvedValue([
      {
        instrument_token: "100",
        exchange_segment: "nse_cm",
        ltp: 250,
        buy_price: 249,
        sell_price: 251,
      },
    ]);

    const quotes = await fetchQuotes(session, [
      { instrumentToken: "100", exchangeSegment: "nse_cm" },
    ]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      instrumentToken: "100",
      exchangeSegment: "nse_cm",
      ltp: 250,
      bestBid: 249,
      bestAsk: 251,
    });
  });

  it("fills empty quotes only for instruments missing from a successful response", async () => {
    kotakFetch.mockResolvedValue([
      {
        instrument_token: "100",
        exchange_segment: "nse_cm",
        ltp: 250,
      },
    ]);

    const quotes = await fetchQuotes(session, [
      { instrumentToken: "100", exchangeSegment: "nse_cm" },
      { instrumentToken: "200", exchangeSegment: "nse_cm" },
    ]);

    expect(quotes).toHaveLength(2);
    expect(quotes.find((quote) => quote.instrumentToken === "200")).toMatchObject({
      ltp: null,
      bestBid: null,
      bestAsk: null,
    });
  });

  it("propagates batch transport failures instead of inventing empty quotes", async () => {
    kotakFetch.mockRejectedValue(
      new KotakApiError("session expired", 403, "session_expired"),
    );

    await expect(
      fetchQuotes(session, [
        { instrumentToken: "100", exchangeSegment: "nse_cm" },
      ]),
    ).rejects.toMatchObject({
      code: "session_expired",
      status: 403,
    });
  });

  it("throws when the broker reports a failure status", async () => {
    kotakFetch.mockResolvedValue({
      status: "error",
      message: "invalid token",
    });

    await expect(
      fetchQuotes(session, [
        { instrumentToken: "100", exchangeSegment: "nse_cm" },
      ]),
    ).rejects.toMatchObject({
      message: "invalid token",
      code: "bad_request",
    });
  });

  it("throws when the broker payload fails schema parsing", async () => {
    kotakFetch.mockResolvedValue({
      data: "not-an-array",
    });

    await expect(
      fetchQuotes(session, [
        { instrumentToken: "100", exchangeSegment: "nse_cm" },
      ]),
    ).rejects.toMatchObject({
      message: "Unexpected quote response shape",
      code: "invalid_response",
    });
  });

  it("throws when a successful response contains no quote rows", async () => {
    kotakFetch.mockResolvedValue([]);

    await expect(
      fetchQuotes(session, [
        { instrumentToken: "100", exchangeSegment: "nse_cm" },
      ]),
    ).rejects.toMatchObject({
      message: "No quote data returned",
      code: "invalid_response",
    });
  });
});
