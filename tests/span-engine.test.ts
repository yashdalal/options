import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computePortfolioMargin,
  mergePositions,
} from "@/server/span/engine";
import { parseSpnStream } from "@/server/span/parse";
import {
  basketLegsToSpanPositions,
  deliveryMarginWarningFor,
} from "@/server/span/positions";

const fixturePath = path.join(
  process.cwd(),
  "tests/fixtures/span/mini.spn",
);

describe("span parse + engine", () => {
  it("parses fixture and margins a short straddle below sum of legs", async () => {
    const parsed = await parseSpnStream(fixturePath);
    const underlying = parsed.underlyings.get("TESTCO");
    expect(underlying?.spot).toBe(100);
    expect(underlying?.contracts).toHaveLength(2);

    const call = computePortfolioMargin(
      [
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "CALL",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -100,
        },
      ],
      parsed.underlyings,
    );
    const put = computePortfolioMargin(
      [
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "PUT",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -100,
        },
      ],
      parsed.underlyings,
    );
    const straddle = computePortfolioMargin(
      [
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "CALL",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -100,
        },
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "PUT",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -100,
        },
      ],
      parsed.underlyings,
    );

    expect(call.span).toBeGreaterThan(0);
    expect(put.span).toBeGreaterThan(0);
    expect(straddle.span).toBeLessThan(call.span + put.span);
    expect(straddle.total).toBe(straddle.span + straddle.exposure);
  });

  it("decodes HTML entities in SPAN pfCode symbols", async () => {
    const parsed = await parseSpnStream(fixturePath);
    expect(parsed.underlyings.has("GVT&D")).toBe(true);
    expect(parsed.underlyings.has("GVT&AMP;D")).toBe(false);
  });

  it("normalizes entity-encoded keys when reading a cached snapshot", async () => {
    const { writeSpanSnapshot, readSpanUnderlyings, resetSpanStoreForTests } =
      await import("@/server/span/store");
    resetSpanStoreForTests();
    const parsed = await parseSpnStream(fixturePath);
    const legacy = new Map(parsed.underlyings);
    const gvt = legacy.get("GVT&D");
    expect(gvt).toBeTruthy();
    legacy.delete("GVT&D");
    legacy.set("GVT&AMP;D", { ...gvt!, symbol: "GVT&AMP;D" });
    await writeSpanSnapshot(
      { date: "20260724", variant: "i5", created: "202607241612" },
      legacy,
    );
    const loaded = await readSpanUnderlyings(["GVT&D"]);
    expect(loaded?.underlyings.has("GVT&D")).toBe(true);
    resetSpanStoreForTests();
  });

  it("merges duplicate contract keys by summing quantity", () => {
    const merged = mergePositions(
      [
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "CALL",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -100,
        },
      ],
      [
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "CALL",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -50,
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(-150);
  });
});

describe("basket leg mapping", () => {
  it("maps sell legs to negative quantities", () => {
    const positions = basketLegsToSpanPositions([
      {
        exchangeSegment: "nse_fo",
        underlying: "TESTCO",
        expiryIso: "2026-07-28",
        strike: 100,
        optionType: "CALL",
        side: "SELL",
        lots: 2,
        lotSize: 50,
      },
    ]);
    expect(positions[0].quantity).toBe(-100);
  });

  it("rejects bse_fo legs", () => {
    expect(() =>
      basketLegsToSpanPositions([
        {
          exchangeSegment: "bse_fo",
          underlying: "TESTCO",
          expiryIso: "2026-07-28",
          strike: 100,
          optionType: "CALL",
          side: "SELL",
          lots: 1,
          lotSize: 50,
        },
      ]),
    ).toThrow(/nse_fo/i);
  });
});

describe("deliveryMarginWarningFor", () => {
  it("warns with expiry dates for stock underlyings within 5 days", () => {
    const warning = deliveryMarginWarningFor(
      [
        {
          underlying: "TESTCO",
          instrumentType: "OPT",
          optionType: "CALL",
          expiryIso: "2026-07-28",
          strike: 100,
          quantity: -50,
        },
        {
          underlying: "OTHER",
          instrumentType: "OPT",
          optionType: "PUT",
          expiryIso: "2026-07-30",
          strike: 100,
          quantity: -50,
        },
      ],
      new Date("2026-07-25T00:00:00.000Z"),
    );
    expect(warning).toBe(
      "Stock derivatives expiring 28 Jul 2026 and 30 Jul 2026 may attract exchange delivery margins not included in SPAN+ELM.",
    );
  });

  it("skips index underlyings", () => {
    const warning = deliveryMarginWarningFor(
      [
        {
          underlying: "NIFTY",
          instrumentType: "OPT",
          optionType: "CALL",
          expiryIso: "2026-07-28",
          strike: 25000,
          quantity: -65,
        },
      ],
      new Date("2026-07-25T00:00:00.000Z"),
    );
    expect(warning).toBeNull();
  });
});
