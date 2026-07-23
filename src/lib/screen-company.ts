import { calculateAnnualizedReturnPct } from "@/domain/screening";
import type { ScreenCandidate, ScreenSnapshot } from "@/domain/types";
import type { AccountId } from "@/config/accounts";
import { filterExpiriesWithinMonthsAhead } from "@/lib/expiry-horizon";

/** Report expiry picker: current IST month through two months ahead. */
export const REPORT_EXPIRY_MONTHS_AHEAD = 2;

export type ScreenCompanyParams = {
  symbol: string;
  expiryIso: string;
  spreadMin: number;
  returnMin: number;
  side: string;
  lots: number;
  accountId: AccountId;
  signal?: AbortSignal;
};

export type ScreenCompanyAuthError = {
  kind: "auth";
};

export type ScreenCompanyResult = {
  snapshot: ScreenSnapshot;
  candidates: ScreenCandidate[];
  qualifying: ScreenCandidate[];
};

export function enrichCandidatesWithMargins(
  candidates: ScreenCandidate[],
  margins: {
    id?: string;
    instrumentToken: string;
    margin: number | null;
    error?: string;
  }[],
  returnMin: number,
): ScreenCandidate[] {
  const byId = new Map(
    margins
      .filter((item) => item.id)
      .map((item) => [item.id as string, item]),
  );
  const byToken = new Map(margins.map((item) => [item.instrumentToken, item]));

  return candidates.map((candidate) => {
    const result = byId.get(candidate.id) ?? byToken.get(candidate.instrumentToken);
    if (!result || candidate.netPremium === null) {
      return candidate;
    }
    const annualizedReturnPct =
      result.margin === null
        ? null
        : calculateAnnualizedReturnPct(
            candidate.netPremium,
            result.margin,
            candidate.calendarDaysLeft,
          );
    return {
      ...candidate,
      margin: result.margin,
      annualizedReturnPct,
      meetsReturn:
        annualizedReturnPct === null ? null : annualizedReturnPct >= returnMin,
    };
  });
}

export function filterQualifyingCandidates(
  candidates: ScreenCandidate[],
): ScreenCandidate[] {
  return candidates.filter(
    (row) => row.meetsSpread && row.meetsReturn === true,
  );
}

function compareByAnnualizedReturnDesc(
  left: ScreenCandidate,
  right: ScreenCandidate,
): number {
  const leftReturn = left.annualizedReturnPct ?? -Infinity;
  const rightReturn = right.annualizedReturnPct ?? -Infinity;
  if (leftReturn !== rightReturn) {
    return rightReturn - leftReturn;
  }
  if (left.strike !== right.strike) {
    return left.strike - right.strike;
  }
  return left.fillIndex - right.fillIndex;
}

export function selectTopCandidatesBySide(
  candidates: ScreenCandidate[],
  topPerSide: number,
): ScreenCandidate[] {
  const limit = Math.max(0, Math.floor(topPerSide));
  const byCompany = new Map<string, ScreenCandidate[]>();
  for (const candidate of candidates) {
    const existing = byCompany.get(candidate.company);
    if (existing) {
      existing.push(candidate);
    } else {
      byCompany.set(candidate.company, [candidate]);
    }
  }

  const selected: ScreenCandidate[] = [];
  for (const company of [...byCompany.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const rows = byCompany.get(company) ?? [];
    const calls = rows
      .filter((row) => row.optionType === "CALL")
      .sort(compareByAnnualizedReturnDesc)
      .slice(0, limit);
    const puts = rows
      .filter((row) => row.optionType === "PUT")
      .sort(compareByAnnualizedReturnDesc)
      .slice(0, limit);
    selected.push(...calls, ...puts);
  }
  return selected;
}

export function companiesForExpiry(
  underlyings: string[],
  expiriesByUnderlying: Record<string, string[]>,
  expiryIso: string,
): { eligible: string[]; skipped: number } {
  const eligible = underlyings.filter((symbol) =>
    (expiriesByUnderlying[symbol] ?? []).includes(expiryIso),
  );
  return {
    eligible,
    skipped: underlyings.length - eligible.length,
  };
}

export function filterCompanyChoices(
  eligible: string[],
  selected: string[],
  query: string,
  emptyQueryLimit = 50,
  allUnderlyings: string[] = eligible,
  expiriesByUnderlying: Record<string, string[]> = {},
  selectedExpiry = "",
  now: Date = new Date(),
): {
  matches: string[];
  truncated: boolean;
  total: number;
  otherExpiryMatches: { symbol: string; expiryIso: string }[];
} {
  const selectedSet = new Set(selected);
  const available = eligible.filter((symbol) => !selectedSet.has(symbol));
  const normalized = query.trim().toUpperCase();

  if (!normalized) {
    return {
      matches: available.slice(0, emptyQueryLimit),
      truncated: available.length > emptyQueryLimit,
      total: available.length,
      otherExpiryMatches: [],
    };
  }

  const matches = available
    .filter((symbol) => symbol.includes(normalized))
    .sort((left, right) => {
      const leftPrefix = left.startsWith(normalized) ? 0 : 1;
      const rightPrefix = right.startsWith(normalized) ? 0 : 1;
      if (leftPrefix !== rightPrefix) {
        return leftPrefix - rightPrefix;
      }
      return left.localeCompare(right);
    });

  const eligibleSet = new Set(eligible);
  const otherExpiryMatches = allUnderlyings
    .filter(
      (symbol) =>
        !selectedSet.has(symbol) &&
        !eligibleSet.has(symbol) &&
        symbol.includes(normalized),
    )
    .flatMap((symbol) => {
      const expiries = filterExpiriesWithinMonthsAhead(
        [...(expiriesByUnderlying[symbol] ?? [])].sort(),
        REPORT_EXPIRY_MONTHS_AHEAD,
        now,
      ).filter((expiry) => expiry !== selectedExpiry);
      return expiries.map((expiryIso) => ({ symbol, expiryIso }));
    })
    .sort((left, right) => {
      const leftPrefix = left.symbol.startsWith(normalized) ? 0 : 1;
      const rightPrefix = right.symbol.startsWith(normalized) ? 0 : 1;
      if (leftPrefix !== rightPrefix) {
        return leftPrefix - rightPrefix;
      }
      const symbolCmp = left.symbol.localeCompare(right.symbol);
      if (symbolCmp !== 0) {
        return symbolCmp;
      }
      return left.expiryIso.localeCompare(right.expiryIso);
    });

  return {
    matches,
    truncated: false,
    total: matches.length,
    otherExpiryMatches,
  };
}

export function listUniqueExpiries(
  expiriesByUnderlying: Record<string, string[]>,
): string[] {
  const expiries = new Set<string>();
  for (const list of Object.values(expiriesByUnderlying)) {
    for (const expiry of list) {
      expiries.add(expiry);
    }
  }
  return [...expiries].sort();
}

/** Expiries shared by every selected symbol. Empty selection → all unique expiries. */
export function listExpiriesForSelection(
  selectedSymbols: string[],
  expiriesByUnderlying: Record<string, string[]>,
  now: Date = new Date(),
): string[] {
  const raw =
    selectedSymbols.length === 0
      ? listUniqueExpiries(expiriesByUnderlying)
      : (() => {
          let shared: Set<string> | null = null;
          for (const symbol of selectedSymbols) {
            const list = expiriesByUnderlying[symbol] ?? [];
            const next = new Set(list);
            if (shared === null) {
              shared = next;
              continue;
            }
            shared = new Set([...shared].filter((expiry) => next.has(expiry)));
          }
          return shared ? [...shared].sort() : [];
        })();

  return filterExpiriesWithinMonthsAhead(raw, REPORT_EXPIRY_MONTHS_AHEAD, now);
}

async function loadMarginsForCandidates(
  candidates: ScreenCandidate[],
  accountId: AccountId,
  returnMin: number,
  signal?: AbortSignal,
): Promise<ScreenCandidate[]> {
  const marginRows = candidates.filter(
    (row) => row.hasBid && row.premium !== null && row.premium > 0,
  );
  if (marginRows.length === 0) {
    return candidates;
  }

  const chunkSize = 5;
  let enriched = candidates;

  for (let index = 0; index < marginRows.length; index += chunkSize) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const chunk = marginRows.slice(index, index + chunkSize);
    const response = await fetch("/api/screen/margin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        items: chunk.map((row) => ({
          id: row.id,
          instrumentToken: row.instrumentToken,
          exchangeSegment: row.exchangeSegment,
          tradingSymbol: row.tradingSymbol,
          premium: row.premium,
          quantity: row.lotSize * row.lots,
        })),
      }),
      signal,
    });
    if (response.status === 401) {
      throw Object.assign(new Error("auth_required"), {
        kind: "auth",
      } satisfies ScreenCompanyAuthError);
    }
    if (!response.ok) {
      continue;
    }
    const payload = (await response.json()) as {
      margins: {
        id?: string;
        instrumentToken: string;
        margin: number | null;
        error?: string;
      }[];
    };
    enriched = enrichCandidatesWithMargins(enriched, payload.margins, returnMin);
  }

  return enriched;
}

export async function screenCompany(
  params: ScreenCompanyParams,
): Promise<ScreenCompanyResult> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    expiry: params.expiryIso,
    spreadMin: String(params.spreadMin),
    returnMin: String(params.returnMin),
    side: params.side,
    lots: String(params.lots),
  });
  const response = await fetch(`/api/screen?${query.toString()}`, {
    cache: "no-store",
    signal: params.signal,
  });
  if (response.status === 401) {
    throw Object.assign(new Error("auth_required"), {
      kind: "auth",
    } satisfies ScreenCompanyAuthError);
  }
  if (!response.ok) {
    throw new Error(`Unable to screen ${params.symbol}`);
  }
  const snapshot = (await response.json()) as ScreenSnapshot;
  const candidates = await loadMarginsForCandidates(
    snapshot.candidates,
    params.accountId,
    params.returnMin,
    params.signal,
  );
  return {
    snapshot: { ...snapshot, candidates },
    candidates,
    qualifying: filterQualifyingCandidates(candidates),
  };
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}
