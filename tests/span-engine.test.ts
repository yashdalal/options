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
  mapRawPositionsToSpan,
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

describe("calculateSingleLegSpanMargins", () => {
  it("returns per-leg SPAN totals for NSE and BSE contracts", async () => {
    const { writeSpanSnapshot, resetSpanStoreForTests } = await import(
      "@/server/span/store"
    );
    const { calculateSingleLegSpanMargins } = await import(
      "@/server/span/service"
    );
    resetSpanStoreForTests();
    const parsed = await parseSpnStream(fixturePath);
    await writeSpanSnapshot(
      { date: "20260724", variant: "i5", created: "202607241612" },
      parsed.underlyings,
    );

    const results = await calculateSingleLegSpanMargins([
      {
        id: "ok",
        exchangeSegment: "nse_fo",
        underlying: "TESTCO",
        expiryIso: "2026-07-28",
        strike: 100,
        optionType: "CALL",
        side: "SELL",
        lots: 1,
        lotSize: 100,
      },
      {
        id: "bse",
        exchangeSegment: "bse_fo",
        underlying: "TESTCO",
        expiryIso: "2026-07-28",
        strike: 100,
        optionType: "CALL",
        side: "SELL",
        lots: 1,
        lotSize: 100,
      },
    ]);

    expect(results[0].id).toBe("ok");
    expect(results[0].spanMargin).toBeGreaterThan(0);
    expect(results[0].error).toBeUndefined();
    expect(results[1].id).toBe("bse");
    expect(results[1].spanMargin).toBe(results[0].spanMargin);
    expect(results[1].error).toBeUndefined();
    resetSpanStoreForTests();
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

  it("maps bse_fo legs", () => {
    const positions = basketLegsToSpanPositions([
      {
        exchangeSegment: "bse_fo",
        underlying: "SENSEX",
        expiryIso: "2026-07-30",
        strike: 80000,
        optionType: "CALL",
        side: "SELL",
        lots: 1,
        lotSize: 20,
      },
    ]);
    expect(positions).toEqual([
      {
        underlying: "SENSEX",
        instrumentType: "OPT",
        optionType: "CALL",
        expiryIso: "2026-07-30",
        strike: 80000,
        quantity: -20,
      },
    ]);
  });

  it("rejects unsupported segments", () => {
    expect(() =>
      basketLegsToSpanPositions([
        {
          exchangeSegment: "mcx_fo",
          underlying: "GOLD",
          expiryIso: "2026-07-28",
          strike: 100000,
          optionType: "CALL",
          side: "SELL",
          lots: 1,
          lotSize: 1,
        },
      ]),
    ).toThrow(/unsupported f&o segment/i);
  });

  it("maps Kotak BSE positions into the SPAN portfolio", () => {
    const positions = mapRawPositionsToSpan(
      [
        {
          exSeg: "bse_fo",
          sym: "SENSEX",
          trdSym: "SENSEX26AUG80000CE",
          optTp: "CE",
          stkPrc: "80000",
          expDt: "2026-08-06",
          lotSz: "20",
          qty: "-40",
        },
      ],
      undefined,
    );
    expect(positions).toEqual([
      {
        underlying: "SENSEX",
        instrumentType: "OPT",
        optionType: "CALL",
        expiryIso: "2026-08-06",
        strike: 80000,
        quantity: -40,
      },
    ]);
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

  it.each(["NIFTY", "BANKEX", "SENSEX", "SENSEX50"])(
    "skips %s index underlyings",
    (underlying) => {
      const warning = deliveryMarginWarningFor(
        [
          {
            underlying,
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
    },
  );
});
