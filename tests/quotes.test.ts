import { describe, expect, it } from "vitest";
import { resolveLtp } from "@/server/kotak/quotes";

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
