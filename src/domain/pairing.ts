import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import type {
  NormalizedPosition,
  OptionType,
  ReportRow,
  ReportRowDetail,
  ReportSide,
} from "./types";
import { calculateProximity } from "./proximity";

const ACCOUNT_ORDER = new Map(
  ACCOUNT_DEFINITIONS.map((definition, index) => [definition.id, index]),
);

function sortStrikesAscending(strikes: number[]): number[] {
  return [...strikes].sort((a, b) => a - b);
}

function sortStrikesDescending(strikes: number[]): number[] {
  return [...strikes].sort((a, b) => b - a);
}

function groupByStrike(
  positions: NormalizedPosition[],
): Map<number, NormalizedPosition[]> {
  const byStrike = new Map<number, NormalizedPosition[]>();
  for (const position of positions) {
    const existing = byStrike.get(position.strike) ?? [];
    existing.push(position);
    byStrike.set(position.strike, existing);
  }
  return byStrike;
}

function aggregateSide(
  optionType: OptionType,
  strike: number,
  positions: NormalizedPosition[],
  spot: number | null,
): ReportSide {
  const lots = positions.reduce((sum, position) => sum + position.netQuantity, 0);
  const shares = positions.reduce(
    (sum, position) => sum + position.netQuantity * position.lotSize,
    0,
  );
  return {
    strike,
    lots,
    shares,
    ...calculateProximity(optionType, strike, spot),
  };
}

function buildDetails(
  callPositions: NormalizedPosition[],
  putPositions: NormalizedPosition[],
  spot: number | null,
): ReportRowDetail[] {
  const byAccount = new Map<
    AccountId,
    { accountLabel: string; calls: NormalizedPosition[]; puts: NormalizedPosition[] }
  >();

  for (const position of callPositions) {
    const existing = byAccount.get(position.accountId) ?? {
      accountLabel: position.accountLabel,
      calls: [],
      puts: [],
    };
    existing.calls.push(position);
    byAccount.set(position.accountId, existing);
  }

  for (const position of putPositions) {
    const existing = byAccount.get(position.accountId) ?? {
      accountLabel: position.accountLabel,
      calls: [],
      puts: [],
    };
    existing.puts.push(position);
    byAccount.set(position.accountId, existing);
  }

  return [...byAccount.entries()]
    .sort(
      ([leftId], [rightId]) =>
        (ACCOUNT_ORDER.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
        (ACCOUNT_ORDER.get(rightId) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([accountId, bucket]) => ({
      accountId,
      accountLabel: bucket.accountLabel,
      call:
        bucket.calls.length > 0
          ? aggregateSide("CALL", bucket.calls[0]!.strike, bucket.calls, spot)
          : null,
      put:
        bucket.puts.length > 0
          ? aggregateSide("PUT", bucket.puts[0]!.strike, bucket.puts, spot)
          : null,
    }));
}

export function pairPositionsForCompany(
  positions: NormalizedPosition[],
  spot: number | null,
): ReportRow[] {
  const sample = positions[0];
  if (!sample) {
    return [];
  }

  const callsByStrike = groupByStrike(positions.filter((p) => p.optionType === "CALL"));
  const putsByStrike = groupByStrike(positions.filter((p) => p.optionType === "PUT"));
  const callStrikes = sortStrikesAscending([...callsByStrike.keys()]);
  const putStrikes = sortStrikesDescending([...putsByStrike.keys()]);
  const rowCount = Math.max(callStrikes.length, putStrikes.length);
  const rows: ReportRow[] = [];

  for (let i = 0; i < rowCount; i += 1) {
    const callStrike = callStrikes[i];
    const putStrike = putStrikes[i];
    const callPositions =
      callStrike === undefined ? [] : (callsByStrike.get(callStrike) ?? []);
    const putPositions =
      putStrike === undefined ? [] : (putsByStrike.get(putStrike) ?? []);

    rows.push({
      company: sample.company,
      spot,
      call:
        callStrike === undefined || callPositions.length === 0
          ? null
          : aggregateSide("CALL", callStrike, callPositions, spot),
      put:
        putStrike === undefined || putPositions.length === 0
          ? null
          : aggregateSide("PUT", putStrike, putPositions, spot),
      details: buildDetails(callPositions, putPositions, spot),
    });
  }

  return rows;
}

export function buildExpiryGroups(
  positions: NormalizedPosition[],
  spotByCompany: Map<string, number | null>,
): { expiryIso: string; expiryLabel: string; rows: ReportRow[] }[] {
  const byExpiry = new Map<string, NormalizedPosition[]>();

  for (const position of positions) {
    const existing = byExpiry.get(position.expiryIso) ?? [];
    existing.push(position);
    byExpiry.set(position.expiryIso, existing);
  }

  return [...byExpiry.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([expiryIso, expiryPositions]) => {
      const byCompany = new Map<string, NormalizedPosition[]>();
      for (const position of expiryPositions) {
        const existing = byCompany.get(position.company) ?? [];
        existing.push(position);
        byCompany.set(position.company, existing);
      }

      const rows = [...byCompany.entries()]
        .sort(([leftCompany], [rightCompany]) => leftCompany.localeCompare(rightCompany))
        .flatMap(([company, companyPositions]) =>
          pairPositionsForCompany(
            companyPositions,
            spotByCompany.get(company) ?? null,
          ),
        );

      return {
        expiryIso,
        expiryLabel: expiryPositions[0]?.expiryLabel ?? expiryIso,
        rows,
      };
    });
}
