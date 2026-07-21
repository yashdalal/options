import type { NormalizedPosition, ReportRow } from "./types";
import { calculateProximity } from "./proximity";

function sortCalls(positions: NormalizedPosition[]): NormalizedPosition[] {
  return [...positions].sort((a, b) => a.strike - b.strike || a.id.localeCompare(b.id));
}

function sortPuts(positions: NormalizedPosition[]): NormalizedPosition[] {
  return [...positions].sort((a, b) => b.strike - a.strike || a.id.localeCompare(b.id));
}

export function pairPositionsForCompany(
  positions: NormalizedPosition[],
  spot: number | null,
): ReportRow[] {
  const calls = sortCalls(positions.filter((p) => p.optionType === "CALL"));
  const puts = sortPuts(positions.filter((p) => p.optionType === "PUT"));
  const company = positions[0]?.company ?? "";
  const rowCount = Math.max(calls.length, puts.length);
  const rows: ReportRow[] = [];

  for (let i = 0; i < rowCount; i += 1) {
    const call = calls[i];
    const put = puts[i];
    rows.push({
      company,
      spot,
      call: call
        ? {
            strike: call.strike,
            lots: call.netQuantity,
            shares: call.netQuantity * call.lotSize,
            ...calculateProximity("CALL", call.strike, spot),
          }
        : null,
      put: put
        ? {
            strike: put.strike,
            lots: put.netQuantity,
            shares: put.netQuantity * put.lotSize,
            ...calculateProximity("PUT", put.strike, spot),
          }
        : null,
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

      const rows = [...byCompany.keys()]
        .sort((a, b) => a.localeCompare(b))
        .flatMap((company) =>
          pairPositionsForCompany(
            byCompany.get(company) ?? [],
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
