"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import { calculateAnnualizedReturnPct } from "@/domain/screening";
import type { ScreenCandidate } from "@/domain/types";
import { formatPercent, formatRupees } from "@/lib/format";

export type BasketLeg = {
  key: string;
  underlying: string;
  exchangeSegment: string;
  expiryIso: string;
  strike: number;
  optionType: "CALL" | "PUT";
  side: "BUY" | "SELL";
  lots: number;
  lotSize: number;
  premium: number | null;
  tradingSymbol: string;
};

type MarginBreakdown = {
  span: number;
  exposure: number;
  total: number;
};

type BasketMarginResponse = {
  spanFile: { date: string; variant: string; exposureSource: string };
  basket: MarginBreakdown;
  account: {
    accountId: AccountId;
    current: MarginBreakdown;
    after: MarginBreakdown;
    incremental: MarginBreakdown;
  } | null;
  deliveryMarginWarning: string | null;
  error?: string;
};

type BasketTrayProps = {
  legs: BasketLeg[];
  onChangeLegs: (legs: BasketLeg[]) => void;
  onLoginRequired: () => void;
  preferredAccountId: AccountId | "";
  onClose: () => void;
  onClear: () => void;
};

function candidateBasketKey(candidate: ScreenCandidate): string {
  return [
    candidate.company,
    candidate.expiryIso,
    candidate.optionType,
    candidate.strike,
    candidate.lotSize,
  ].join("|");
}

function candidateToBasketLeg(candidate: ScreenCandidate): BasketLeg {
  return {
    key: candidateBasketKey(candidate),
    underlying: candidate.company,
    exchangeSegment: candidate.exchangeSegment,
    expiryIso: candidate.expiryIso,
    strike: candidate.strike,
    optionType: candidate.optionType,
    side: "SELL",
    lots: candidate.lots,
    lotSize: candidate.lotSize,
    premium: candidate.premium,
    tradingSymbol: candidate.tradingSymbol,
  };
}

export function isCandidateInBasket(
  legs: BasketLeg[],
  candidate: ScreenCandidate,
): boolean {
  const key = candidateBasketKey(candidate);
  return legs.some((leg) => leg.key === key);
}

export function upsertBasketLeg(
  legs: BasketLeg[],
  candidate: ScreenCandidate,
): BasketLeg[] {
  const incoming = candidateToBasketLeg(candidate);
  const index = legs.findIndex((leg) => leg.key === incoming.key);
  if (index < 0) {
    return [...legs, incoming];
  }
  return legs.map((leg, legIndex) =>
    legIndex === index
      ? { ...leg, lots: leg.lots + incoming.lots, premium: incoming.premium }
      : leg,
  );
}

export function removeBasketLeg(
  legs: BasketLeg[],
  candidate: ScreenCandidate,
): BasketLeg[] {
  const key = candidateBasketKey(candidate);
  return legs.filter((leg) => leg.key !== key);
}

function formatSpanLabel(date: string, variant: string): string {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  const day = date.slice(6, 8);
  const label = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    });
  return `SPAN ${label} ${variant}`;
}

function legsSignature(legs: BasketLeg[]): string {
  return JSON.stringify(
    legs.map((leg) => ({
      underlying: leg.underlying,
      expiryIso: leg.expiryIso,
      strike: leg.strike,
      optionType: leg.optionType,
      side: leg.side,
      lots: leg.lots,
      lotSize: leg.lotSize,
      exchangeSegment: leg.exchangeSegment,
    })),
  );
}

export function BasketTray({
  legs,
  onChangeLegs,
  onLoginRequired,
  preferredAccountId,
  onClose,
  onClear,
}: BasketTrayProps) {
  const [accountId, setAccountId] = useState<AccountId | "">(preferredAccountId);
  const [syncedAccountId, setSyncedAccountId] = useState(preferredAccountId);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BasketMarginResponse | null>(null);
  const requestIdRef = useRef(0);

  if (preferredAccountId !== syncedAccountId) {
    setSyncedAccountId(preferredAccountId);
    setAccountId(preferredAccountId);
  }

  const netPremium = useMemo(() => {
    return legs.reduce((sum, leg) => {
      if (leg.premium === null) {
        return sum;
      }
      const sign = leg.side === "SELL" ? 1 : -1;
      return sum + sign * leg.premium * leg.lotSize * leg.lots;
    }, 0);
  }, [legs]);

  const sharedExpiry = useMemo(() => {
    if (legs.length === 0) {
      return null;
    }
    const first = legs[0].expiryIso;
    return legs.every((leg) => leg.expiryIso === first) ? first : null;
  }, [legs]);

  const daysLeft = useMemo(() => {
    if (!sharedExpiry) {
      return null;
    }
    const [year, month, day] = sharedExpiry.split("-").map(Number);
    const expiry = Date.UTC(year, month - 1, day);
    const today = new Date();
    const start = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    return Math.max(0, Math.round((expiry - start) / 86_400_000));
  }, [sharedExpiry]);

  const capitalForReturn =
    result?.account?.incremental.total ?? result?.basket.total ?? null;
  const periodReturnPct =
    capitalForReturn !== null && capitalForReturn > 0
      ? (netPremium / capitalForReturn) * 100
      : null;
  const annualizedReturn =
    capitalForReturn !== null && daysLeft !== null
      ? calculateAnnualizedReturnPct(netPremium, capitalForReturn, daysLeft)
      : null;

  async function calculateMargin(signal?: AbortSignal) {
    if (legs.length === 0) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/margin/basket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountId || undefined,
          legs: legs.map((leg) => ({
            exchangeSegment: leg.exchangeSegment,
            underlying: leg.underlying,
            expiryIso: leg.expiryIso,
            strike: leg.strike,
            optionType: leg.optionType,
            side: leg.side,
            lots: leg.lots,
            lotSize: leg.lotSize,
          })),
        }),
        signal,
      });
      if (signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      const payload = (await response.json()) as BasketMarginResponse & {
        error?: string;
        code?: string;
      };
      if (response.status === 401 || payload.code === "login_required") {
        onLoginRequired();
        setError("Login required");
        setResult(null);
        return;
      }
      if (!response.ok) {
        setResult(null);
        setError(payload.error ?? "Unable to calculate basket margin");
        return;
      }
      setResult(payload);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResult(null);
      setError("Unable to reach margin API");
    } finally {
      if (
        requestId === requestIdRef.current &&
        !signal?.aborted
      ) {
        setLoading(false);
      }
    }
  }

  const basketRequestKey = useMemo(
    () => `${accountId}|${legsSignature(legs)}`,
    [accountId, legs],
  );

  useEffect(() => {
    if (legs.length === 0) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void calculateMargin(controller.signal);
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recalc keyed by basketRequestKey
  }, [basketRequestKey]);

  async function refreshSpan() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/margin/span-refresh", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        code?: string;
      };
      if (response.status === 401 || payload.code === "login_required") {
        onLoginRequired();
        setError("Login required");
        return;
      }
      if (!response.ok) {
        setError(payload.error ?? "Unable to refresh SPAN file");
        return;
      }
      if (legs.length > 0) {
        await calculateMargin();
      }
    } catch {
      setError("Unable to refresh SPAN file");
    } finally {
      setRefreshing(false);
    }
  }

  const marginSummary =
    legs.length === 0 ? (
      <p className="text-sm text-zinc-500">Use Add on a report row.</p>
    ) : error ? (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-sm text-rose-800">
        {error}
      </div>
    ) : loading && !result ? (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-zinc-500">Net premium</span>
          <span className="text-xl font-semibold tabular-nums text-zinc-950">
            {formatRupees(netPremium, 0)}
          </span>
        </div>
        <p className="text-sm text-zinc-500">Calculating margin…</p>
      </div>
    ) : result ? (
      <div className="space-y-2.5 text-sm">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div>
            <div className="text-xs font-medium text-zinc-500">Net premium</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-950">
              {formatRupees(netPremium, 0)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-zinc-500">
              Extra margin (ΔM)
              {loading ? (
                <span className="ml-1 font-normal text-zinc-400">…</span>
              ) : null}
            </div>
            <div
              className={`mt-0.5 text-xl font-semibold tabular-nums text-zinc-950 ${
                loading ? "opacity-60" : ""
              }`}
            >
              {formatRupees(capitalForReturn, 0)}
            </div>
          </div>
          {periodReturnPct !== null ? (
            <div>
              <div className="text-xs font-medium text-zinc-500">
                Return
                {daysLeft !== null ? ` · ${daysLeft}d` : ""}
              </div>
              <div
                className={`mt-0.5 text-xl font-semibold tabular-nums text-emerald-800 ${
                  loading ? "opacity-60" : ""
                }`}
              >
                {formatPercent(periodReturnPct)}
              </div>
            </div>
          ) : null}
          {sharedExpiry && annualizedReturn !== null ? (
            <div>
              <div className="text-xs font-medium text-zinc-500">Ann. return</div>
              <div
                className={`mt-0.5 text-xl font-semibold tabular-nums text-emerald-800 ${
                  loading ? "opacity-60" : ""
                }`}
              >
                {formatPercent(annualizedReturn)}
                <span className="ml-1 text-sm font-medium text-zinc-500">p.a.</span>
              </div>
            </div>
          ) : null}
        </div>
        {!sharedExpiry ? (
          <p className="text-xs text-zinc-500">
            Ann. return hidden for mixed-expiry baskets.
          </p>
        ) : null}
        {legs.some((leg) => leg.premium === null) ? (
          <p className="text-xs text-amber-800">Some legs missing premium.</p>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
          <span>
            {loading
              ? "Updating margin…"
              : formatSpanLabel(result.spanFile.date, result.spanFile.variant)}
          </span>
          <button
            type="button"
            onClick={() => void refreshSpan()}
            disabled={refreshing || loading}
            className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950 disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh file"}
          </button>
        </div>
        {result.deliveryMarginWarning ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
            {result.deliveryMarginWarning}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-zinc-500">Net premium</span>
          <span className="text-xl font-semibold tabular-nums text-zinc-950">
            {formatRupees(netPremium, 0)}
          </span>
        </div>
        <p className="text-sm text-zinc-600">
          Margin appears after legs are added.
        </p>
      </div>
    );

  const legsList = (
    <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto text-sm">
      {legs.map((leg) => (
        <li
          key={leg.key}
          className="flex items-center gap-2 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-zinc-900">
              {leg.underlying} {leg.strike}{" "}
              {leg.optionType === "CALL" ? "CE" : "PE"}
            </div>
            <div className="text-xs tabular-nums text-zinc-500">
              {formatRupees(leg.premium)}
            </div>
          </div>
          <select
            value={leg.side}
            onChange={(event) => {
              const side = event.target.value as "BUY" | "SELL";
              onChangeLegs(
                legs.map((row) =>
                  row.key === leg.key ? { ...row, side } : row,
                ),
              );
            }}
            className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm"
          >
            <option value="SELL">SELL</option>
            <option value="BUY">BUY</option>
          </select>
          <input
            type="number"
            min={1}
            step={1}
            value={leg.lots}
            onChange={(event) => {
              const lots = Math.max(1, Number(event.target.value) || 1);
              onChangeLegs(
                legs.map((row) =>
                  row.key === leg.key ? { ...row, lots } : row,
                ),
              );
            }}
            className="w-14 rounded border border-zinc-300 px-1.5 py-1 text-sm tabular-nums"
            aria-label="Lots"
          />
          <button
            type="button"
            onClick={() => {
              onChangeLegs(legs.filter((row) => row.key !== leg.key));
            }}
            className="shrink-0 text-sm font-medium text-rose-700 hover:underline"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-sm">
      <div className="shrink-0 space-y-2.5 border-b border-zinc-200 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Basket</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {legs.length === 0
                ? "No legs yet"
                : `${legs.length} leg${legs.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                requestIdRef.current += 1;
                setResult(null);
                setError(null);
                setLoading(false);
                onClear();
              }}
              disabled={legs.length === 0}
              title="Remove all legs and close the basket"
              className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-sm font-medium text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear basket
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Hide the basket panel; legs stay selected"
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Hide
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <span className="shrink-0 font-medium">Account</span>
          <select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value as AccountId | "");
            }}
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">None (basket only)</option>
            {ACCOUNT_DEFINITIONS.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="shrink-0 border-b border-zinc-200 px-3 py-3">
        {marginSummary}
      </div>
      {legs.length > 0 ? (
        legsList
      ) : (
        <div className="flex min-h-0 flex-1 px-3 py-4">
          <p className="text-sm text-zinc-500">Use Add on a report row.</p>
        </div>
      )}
    </div>
  );

}
