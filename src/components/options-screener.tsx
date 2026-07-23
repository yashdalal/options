"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import type {
  ScreenCandidate,
  ScreenMeta,
  ScreenSideFilter,
  ScreenSnapshot,
} from "@/domain/types";
import { useScreenerSettings } from "@/hooks/use-screener-settings";
import { filterQualifyingCandidates, screenCompany } from "@/lib/screen-company";
import { NumberInput } from "@/components/number-input";
import { PriceRangeBars, optionSideBadgeClass, optionSideTextClass } from "@/components/price-range-bars";

type OptionsScreenerProps = {
  onLogout: () => void;
  onLoginRequired: () => void;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

function formatExpiryLabel(expiryIso: string): string {
  const [year, month, day] = expiryIso.split("-").map(Number);
  if (!year || !month || !day) {
    return expiryIso;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function OptionsScreener({ onLogout, onLoginRequired }: OptionsScreenerProps) {
  const [settings, setSettings] = useScreenerSettings();
  const [meta, setMeta] = useState<ScreenMeta | null>(null);
  const [symbol, setSymbol] = useState("");
  const [expiryIso, setExpiryIso] = useState("");
  const [snapshot, setSnapshot] = useState<ScreenSnapshot | null>(null);
  const [candidates, setCandidates] = useState<ScreenCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const expiries = useMemo(() => {
    if (!meta || !symbol) {
      return [];
    }
    return meta.expiriesByUnderlying[symbol] ?? [];
  }, [meta, symbol]);

  const selectedExpiry = useMemo(() => {
    if (!expiries.length) {
      return "";
    }
    return expiries.includes(expiryIso) ? expiryIso : expiries[0];
  }, [expiries, expiryIso]);

  function selectSymbol(nextSymbol: string) {
    setSymbol(nextSymbol);
    const nextExpiries = meta?.expiriesByUnderlying[nextSymbol] ?? [];
    setExpiryIso(nextExpiries[0] ?? "");
  }

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/screen/meta", { cache: "no-store" });
      if (response.status === 401) {
        onLoginRequired();
        return;
      }
      if (!response.ok) {
        setError("Unable to load company list from scrip master.");
        return;
      }
      const payload = (await response.json()) as ScreenMeta;
      setMeta(payload);
      const firstSymbol = payload.underlyings[0] ?? "";
      setSymbol((current) => current || firstSymbol);
      if (firstSymbol) {
        const firstExpiries = payload.expiriesByUnderlying[firstSymbol] ?? [];
        setExpiryIso((current) => current || firstExpiries[0] || "");
      }
    } catch {
      setError("Unable to reach the local server for screener meta.");
    } finally {
      setMetaLoading(false);
    }
  }, [onLoginRequired]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount fetch
    void loadMeta();
  }, [loadMeta]);

  const runScreen = useCallback(async () => {
    if (!symbol || !selectedExpiry) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await screenCompany({
        symbol,
        expiryIso: selectedExpiry,
        spreadMin: settings.spreadMin,
        returnMin: settings.returnMin,
        side: settings.side,
        lots: settings.lots,
        accountId: settings.accountId,
      });
      setSnapshot(result.snapshot);
      setCandidates(result.candidates);
    } catch (err) {
      if (
        typeof err === "object" &&
        err &&
        "kind" in err &&
        (err as { kind?: string }).kind === "auth"
      ) {
        onLoginRequired();
        return;
      }
      setError("Unable to reach the local server for screener data.");
    } finally {
      setLoading(false);
    }
  }, [onLoginRequired, selectedExpiry, settings, symbol]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const qualifyingCandidates = useMemo(
    () => filterQualifyingCandidates(candidates),
    [candidates],
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-900">Options Sell Screener</h1>
            <p className="text-sm text-zinc-600">
              Pick one company and expiry. Only options that meet min spread and min annualized
              return are shown.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => void runScreen()}
              disabled={loading || metaLoading || !symbol || !selectedExpiry}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading ? "Screening…" : "Run screen"}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Company
            <select
              value={symbol}
              onChange={(event) => selectSymbol(event.target.value)}
              disabled={metaLoading}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5"
            >
              {(meta?.underlyings ?? []).map((underlying) => (
                <option key={underlying} value={underlying}>
                  {underlying}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Expiry
            <select
              value={selectedExpiry}
              onChange={(event) => setExpiryIso(event.target.value)}
              disabled={!expiries.length}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5"
            >
              {expiries.map((expiry) => (
                <option key={expiry} value={expiry}>
                  {formatExpiryLabel(expiry)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Side
            <select
              value={settings.side}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  side: event.target.value as ScreenSideFilter,
                }))
              }
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5"
            >
              <option value="BOTH">Both</option>
              <option value="CALL">Calls</option>
              <option value="PUT">Puts</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Margin account
            <select
              value={settings.accountId}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  accountId: event.target.value as AccountId,
                }))
              }
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5"
            >
              {ACCOUNT_DEFINITIONS.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Min spread %
            <NumberInput
              value={settings.spreadMin}
              onValueChange={(spreadMin) =>
                setSettings((current) => ({ ...current, spreadMin }))
              }
              className="rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Min return % p.a.
            <NumberInput
              value={settings.returnMin}
              onValueChange={(returnMin) =>
                setSettings((current) => ({ ...current, returnMin }))
              }
              className="rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Lots
            <NumberInput
              value={settings.lots}
              onValueChange={(lots) => setSettings((current) => ({ ...current, lots }))}
              min={1}
              integer
              className="rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Spot</span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {formatNumber(snapshot?.spot)}
          </span>
        </div>
        {snapshot?.priceRanges || snapshot?.priceRangesError ? (
          <PriceRangeBars
            ranges={snapshot.priceRanges}
            spot={snapshot.spot}
            error={snapshot.priceRangesError}
          />
        ) : null}
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Total days to expiry
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {snapshot?.calendarDaysLeft ?? "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Working days to expiry
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {snapshot?.workingDaysLeft ?? "—"}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 sm:ml-auto">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Updated
          </span>
          <span className="text-base font-medium text-zinc-800">
            {snapshot
              ? new Date(snapshot.generatedAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })
              : "—"}
          </span>
        </div>
      </div>

      <details className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800 select-none">
          Calculation formulas
        </summary>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-zinc-800">Spread % (CE)</dt>
            <dd className="font-mono text-xs text-zinc-600 sm:text-sm">
              ((strike − spot) / spot) × 100
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-zinc-800">Spread % (PE)</dt>
            <dd className="font-mono text-xs text-zinc-600 sm:text-sm">
              ((spot − strike) / spot) × 100
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-zinc-800">Diff ₹</dt>
            <dd className="font-mono text-xs text-zinc-600 sm:text-sm">|strike − spot|</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-zinc-800">Total net premium</dt>
            <dd className="font-mono text-xs text-zinc-600 sm:text-sm">
              premium turnover − sell charges
            </dd>
            <dd className="text-xs text-zinc-500">
              Charges: ₹10 brokerage/order + STT 0.15% + exchange ~0.03503% + SEBI 0.0001%; GST
              18% on (brokerage + exchange + SEBI)
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-zinc-800">Ann. return %</dt>
            <dd className="font-mono text-xs text-zinc-600 sm:text-sm">
              (net premium / margin) × (365 / calendar days) × 100
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-zinc-800">Bid / Margin</dt>
            <dd className="text-xs text-zinc-600 sm:text-sm">
              Bid from order-book buy depth; margin from broker check-margin API
            </dd>
          </div>
        </dl>
      </details>

      {snapshot?.coverage ? (
        <p className="text-sm text-zinc-600">
          {loading
            ? `Checking return on ${snapshot.coverage.meetsSpreadMinWithBid} options at/above min spread…`
            : `${qualifyingCandidates.length} meet min spread and min return % (${snapshot.coverage.meetsSpreadMinWithBid} passed spread with a live bid).`}
        </p>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[inset_0_-1px_0_#d4d4d8]">
            <tr className="text-left text-zinc-700">
              {(
                [
                  { heading: "Side" },
                  { heading: "Strike" },
                  { heading: "Lots" },
                  {
                    heading: "Spread %",
                    title:
                      "CE: ((strike − spot) / spot) × 100 · PE: ((spot − strike) / spot) × 100",
                  },
                  {
                    heading: "Ann. return %",
                    title: "(net premium / margin) × (365 / calendar days) × 100",
                  },
                  { heading: "Diff ₹", title: "|strike − spot|" },
                  { heading: "Bid", title: "Best fillable bid from order-book buy depth" },
                  {
                    heading: "Total Net premium",
                    title:
                      "premium turnover − (₹10 brokerage + STT 0.15% + exchange ~0.03503% + SEBI 0.0001% + GST 18% on brokerage/exchange/SEBI)",
                  },
                  { heading: "Margin", title: "From broker check-margin API" },
                ] satisfies { heading: string; title?: string }[]
              ).map(({ heading, title }) => (
                <th
                  key={heading}
                  title={title}
                  className="border-b border-zinc-200 px-3 py-2 font-semibold whitespace-nowrap"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {qualifyingCandidates.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                  {metaLoading
                    ? "Loading companies…"
                    : loading
                      ? "Screening…"
                      : snapshot
                        ? "No options meet both min spread and min return %."
                        : "Run a screen for the selected company and expiry."}
                </td>
              </tr>
            ) : (
              qualifyingCandidates.map((row, index) => (
                <tr
                  key={row.id}
                  className={`${index % 2 === 0 ? "bg-white" : "bg-zinc-50"} font-medium ${optionSideTextClass(row.optionType)}`}
                >
                  <td className="border-b border-zinc-100 px-3 py-2">
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${optionSideBadgeClass(row.optionType)}`}
                    >
                      {row.optionType === "CALL" ? "Call" : "Put"}
                    </span>
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatNumber(row.strike)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatNumber(row.lots, 0)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatPercent(row.spreadPct)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 font-semibold tabular-nums">
                    {formatPercent(row.annualizedReturnPct)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatNumber(row.priceDiffInr)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatNumber(row.premium)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatNumber(row.netPremium, 0)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatNumber(row.margin, 0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
