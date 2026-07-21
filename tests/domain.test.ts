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
  shouldHighlightSide,
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

const prakashAccount = { accountId: "prakash" as const, accountLabel: "Prakash" };
const gopaAccount = { accountId: "gopa" as const, accountLabel: "Gopa" };

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
      prakashAccount,
    );
    expect(normalized).toHaveLength(6);
    expect(normalized.every((item) => item.exchangeSegment === "nse_fo")).toBe(true);
    expect(normalized.every((item) => item.accountId === "prakash")).toBe(true);
    expect(normalized.find((item) => item.company === "ASHOKLEY")).toBeUndefined();
  });

  it("supports CE/PE aliases and decimal strikes", () => {
    const normalized = normalizePositions(
      positionsFixture.data as RawPosition[],
      registryFromFixtures(),
      prakashAccount,
    );
    const mm = normalized.find((item) => item.company === "M&M");
    expect(mm?.optionType).toBe("CALL");
    expect(mm?.strike).toBe(3000.5);
    expect(mm?.id.startsWith("prakash:")).toBe(true);
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
    expect(parseExpiryValue("28 Jul, 2026")).toBe("2026-07-28");
    expect(formatExpiryLabel("2025-07-31")).toBe("31 JUL 2025");
  });
});

describe("pairing", () => {
  const base = (overrides: Partial<NormalizedPosition>): NormalizedPosition => ({
    id: overrides.id ?? "1",
    accountId: overrides.accountId ?? "prakash",
    accountLabel: overrides.accountLabel ?? "Prakash",
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
    expect(rows[0]?.company).toBe("BOSCHLTD");
    expect(rows[0]?.call?.strike).toBe(45000);
    expect(rows[0]?.put?.strike).toBe(44000);
    expect(rows[1]?.call?.strike).toBe(46000);
    expect(rows[1]?.put).toBeNull();
  });

  it("collapses duplicate strikes into one combined side", () => {
    const rows = pairPositionsForCompany(
      [
        base({ id: "c1", optionType: "CALL", strike: 45000, netQuantity: -1, lotSize: 15 }),
        base({
          id: "c2",
          accountId: "gopa",
          accountLabel: "Gopa",
          optionType: "CALL",
          strike: 45000,
          netQuantity: -2,
          lotSize: 15,
        }),
      ],
      45100,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.call?.lots).toBe(-3);
    expect(rows[0]?.call?.shares).toBe(-45);
    expect(rows[0]?.details.map((detail) => detail.accountLabel)).toEqual([
      "Prakash",
      "Gopa",
    ]);
    expect(rows[0]?.details[0]?.call?.lots).toBe(-1);
    expect(rows[0]?.details[1]?.call?.lots).toBe(-2);
  });

  it("pairs calls and puts across accounts on one company row", () => {
    const groups = buildExpiryGroups(
      [
        base({
          id: "prakash-call",
          accountId: "prakash",
          accountLabel: "Prakash",
          optionType: "CALL",
          strike: 45000,
          company: "BOSCHLTD",
        }),
        base({
          id: "gopa-put",
          accountId: "gopa",
          accountLabel: "Gopa",
          optionType: "PUT",
          strike: 44000,
          company: "BOSCHLTD",
        }),
      ],
      new Map([["BOSCHLTD", 45100]]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toHaveLength(1);
    const row = groups[0]?.rows[0];
    expect(row?.call?.strike).toBe(45000);
    expect(row?.put?.strike).toBe(44000);
    expect(row?.details).toHaveLength(2);
    expect(row?.details[0]?.accountLabel).toBe("Prakash");
    expect(row?.details[0]?.call?.strike).toBe(45000);
    expect(row?.details[0]?.put).toBeNull();
    expect(row?.details[1]?.accountLabel).toBe("Gopa");
    expect(row?.details[1]?.put?.strike).toBe(44000);
    expect(row?.details[1]?.call).toBeNull();
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
    expect(shouldHighlightSide(5, 10)).toBe(true);
    expect(shouldHighlightSide(12, 10)).toBe(false);
    expect(shouldHighlightSide(null, 10)).toBe(false);
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
      prakashAccount,
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
    expect(mmRow?.details[0]?.accountLabel).toBe("Prakash");
    expect(mmRow?.spot).toBeNull();
    expect(mmRow?.call?.inrNear).toBeNull();
    expect(mmRow?.call?.pctNear).toBeNull();
  });

  it("combines overlapping company positions across accounts and sorts by company", () => {
    const registry = registryFromFixtures();
    const prakash = normalizePositions(
      positionsFixture.data as RawPosition[],
      registry,
      prakashAccount,
    );
    const gopa = normalizePositions(
      positionsFixture.data as RawPosition[],
      registry,
      gopaAccount,
    );
    const groups = buildExpiryGroups(
      [...prakash, ...gopa],
      new Map([
        ["SBIN", 868.5],
        ["BOSCHLTD", 45100],
        ["M&M", 3000],
      ]),
    );
    const july = groups.find((group) => group.expiryIso === "2025-07-31");
    const julyCompanies = july?.rows.map((row) => row.company) ?? [];
    expect(julyCompanies).toEqual([...julyCompanies].sort((a, b) => a.localeCompare(b)));

    const sbinRows = july?.rows.filter((row) => row.company === "SBIN") ?? [];
    expect(sbinRows).toHaveLength(1);
    expect(sbinRows[0]?.details.map((detail) => detail.accountLabel)).toEqual([
      "Prakash",
      "Gopa",
    ]);
    expect(sbinRows[0]?.call?.lots).toBe(-2);
    expect(sbinRows[0]?.put?.lots).toBe(-2);
  });
});
