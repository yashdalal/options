import { describe, expect, it } from "vitest";
import positionsFixture from "./fixtures/kotak/positions.json";
import {
  computeNetQuantity,
  formatExpiryLabel,
  normalizePositions,
  parseExpiryValue,
} from "@/domain/positions";
import { buildExpiryGroups, pairPositionsForCompany } from "@/domain/pairing";
import {
  calculateInrNear,
  calculatePctNear,
  calculateProximity,
  shouldHighlightRow,
} from "@/domain/proximity";
import { parseScripCsv } from "@/server/kotak/scrip-master";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NormalizedPosition } from "@/domain/types";
import type { RawPosition } from "@/server/kotak/positions";

const foCsv = readFileSync(
  path.join(process.cwd(), "tests/fixtures/kotak/nse_fo.csv"),
  "utf8",
);
const cmCsv = readFileSync(
  path.join(process.cwd(), "tests/fixtures/kotak/nse_cm.csv"),
  "utf8",
);

function registryFromFixtures() {
  const instruments = [
    ...parseScripCsv(foCsv, "nse_fo"),
    ...parseScripCsv(cmCsv, "nse_cm"),
  ];
  const byToken = new Map(instruments.map((item) => [`${item.exchangeSegment}:${item.instrumentToken}`, item]));
  const cashBySymbol = new Map<string, (typeof instruments)[number]>();
  for (const instrument of instruments) {
    if (instrument.exchangeSegment === "nse_cm") {
      cashBySymbol.set(instrument.underlying.toUpperCase(), instrument);
    }
  }
  return { asOfDate: "2025-07-19", byToken, cashBySymbol };
}

describe("normalizePositions", () => {
  it("keeps open NSE options and drops cash/zero rows", () => {
    const normalized = normalizePositions(
      positionsFixture.data as RawPosition[],
      registryFromFixtures(),
    );
    expect(normalized).toHaveLength(6);
    expect(normalized.every((item) => item.exchangeSegment === "nse_fo")).toBe(true);
    expect(normalized.find((item) => item.company === "ASHOKLEY")).toBeUndefined();
  });

  it("supports CE/PE aliases and decimal strikes", () => {
    const normalized = normalizePositions(
      positionsFixture.data as RawPosition[],
      registryFromFixtures(),
    );
    const mm = normalized.find((item) => item.company === "M&M");
    expect(mm?.optionType).toBe("CALL");
    expect(mm?.strike).toBe(3000.5);
  });

  it("computes net quantity from carry/fill fields", () => {
    expect(
      computeNetQuantity({
        cfBuyQty: "0",
        flBuyQty: "0",
        cfSellQty: "150",
        flSellQty: "0",
        lotSz: "150",
      }),
    ).toBe(-1);
  });
});

describe("expiry parsing", () => {
  it("parses day-month-year and formats labels with year", () => {
    expect(parseExpiryValue("31-Jul-2025")).toBe("2025-07-31");
    expect(formatExpiryLabel("2025-07-31")).toBe("31 JUL 2025");
  });
});

describe("pairing", () => {
  const base = (overrides: Partial<NormalizedPosition>): NormalizedPosition => ({
    id: overrides.id ?? "1",
    company: overrides.company ?? "BOSCHLTD",
    exchangeSegment: "nse_fo",
    instrumentToken: overrides.instrumentToken ?? "1",
    tradingSymbol: overrides.tradingSymbol ?? "X",
    optionType: overrides.optionType ?? "CALL",
    strike: overrides.strike ?? 1,
    expiryIso: overrides.expiryIso ?? "2025-08-28",
    expiryLabel: overrides.expiryLabel ?? "28 AUG 2025",
    netQuantity: overrides.netQuantity ?? -1,
    lotSize: overrides.lotSize ?? 1,
  });

  it("pairs unequal calls and puts without dropping rows", () => {
    const rows = pairPositionsForCompany(
      [
        base({ id: "c1", optionType: "CALL", strike: 45000 }),
        base({ id: "c2", optionType: "CALL", strike: 46000 }),
        base({ id: "p1", optionType: "PUT", strike: 44000 }),
      ],
      45100,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.call?.strike).toBe(45000);
    expect(rows[0]?.put?.strike).toBe(44000);
    expect(rows[1]?.call?.strike).toBe(46000);
    expect(rows[1]?.put).toBeNull();
  });

  it("never collapses duplicate contracts", () => {
    const rows = pairPositionsForCompany(
      [
        base({ id: "c1", optionType: "CALL", strike: 45000 }),
        base({ id: "c2", optionType: "CALL", strike: 45000 }),
      ],
      45100,
    );
    expect(rows).toHaveLength(2);
  });
});

describe("proximity", () => {
  it("keeps signed INR near and positive percent near", () => {
    expect(calculateInrNear("CALL", 900, 868.5)).toBeCloseTo(31.5);
    expect(calculateInrNear("PUT", 850, 868.5)).toBeCloseTo(18.5);
    expect(calculatePctNear(31.5, 868.5)).toBeCloseTo((31.5 / 868.5) * 100);
  });

  it("leaves blanks for missing or invalid spot", () => {
    expect(calculateProximity("CALL", 900, null)).toEqual({
      inrNear: null,
      pctNear: null,
    });
    expect(calculateProximity("CALL", 900, 0)).toEqual({
      inrNear: null,
      pctNear: null,
    });
  });

  it("highlights only when a present percent is below threshold", () => {
    expect(shouldHighlightRow(5, null, 10)).toBe(true);
    expect(shouldHighlightRow(null, 12, 10)).toBe(false);
    expect(shouldHighlightRow(null, null, 10)).toBe(false);
  });
});

describe("buildExpiryGroups", () => {
  it("groups by full expiry date and marks missing prices", () => {
    const normalized = normalizePositions(
      positionsFixture.data as RawPosition[],
      registryFromFixtures(),
    );
    const spotByCompany = new Map<string, number | null>([
      ["SBIN", 868.5],
      ["BOSCHLTD", 45100],
      ["M&M", null],
    ]);
    const groups = buildExpiryGroups(normalized, spotByCompany);
    expect(groups.map((group) => group.expiryIso)).toEqual([
      "2025-07-31",
      "2025-08-28",
    ]);
    const july = groups[0];
    const mmRow = july?.rows.find((row) => row.company === "M&M");
    expect(mmRow?.spot).toBeNull();
    expect(mmRow?.call?.inrNear).toBeNull();
    expect(mmRow?.call?.pctNear).toBeNull();
  });
});
