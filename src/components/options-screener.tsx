"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import { calculateAnnualizedReturnPct } from "@/domain/screening";
import type {
  ScreenCandidate,
  ScreenMeta,
  ScreenSideFilter,
  ScreenSnapshot,
} from "@/domain/types";

const SETTINGS_KEY = "options_screener_settings";

type ScreenerSettings = {
  spreadMin: number;
  returnMin: number;
  lots: number;
  side: ScreenSideFilter;
  accountId: AccountId;
};

const DEFAULT_SETTINGS: ScreenerSettings = {
  spreadMin: 18,
  returnMin: 24,
  lots: 1,
  side: "BOTH",
  accountId: "prakash",
};

type OptionsScreenerProps = {
  onLogout: () => void;
  onLoginRequired: () => void;
};

function readSettings(): ScreenerSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<ScreenerSettings>;
    return {
      spreadMin: Number(parsed.spreadMin) || DEFAULT_SETTINGS.spreadMin,
      returnMin: Number(parsed.returnMin) || DEFAULT_SETTINGS.returnMin,
      lots: Math.max(1, Math.floor(Number(parsed.lots) || 1)),
      side:
        parsed.side === "CALL" || parsed.side === "PUT" || parsed.side === "BOTH"
          ? parsed.side
          : "BOTH",
      accountId:
        parsed.accountId && ACCOUNT_DEFINITIONS.some((item) => item.id === parsed.accountId)
          ? parsed.accountId
          : "prakash",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

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

type EnrichedCandidate = ScreenCandidate & {
  marginLoading?: boolean;
  marginError?: string;
};

export function OptionsScreener({ onLogout, onLoginRequired }: OptionsScreenerProps) {
  const [settings, setSettings] = useState<ScreenerSettings>(() => readSettings());
  const [meta, setMeta] = useState<ScreenMeta | null>(null);
  const [symbol, setSymbol] = useState("");
  const [expiryIso, setExpiryIso] = useState("");
  const [snapshot, setSnapshot] = useState<ScreenSnapshot | null>(null);
  const [candidates, setCandidates] = useState<EnrichedCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

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

  const loadMargins = useCallback(
    async (rows: ScreenCandidate[]) => {
      const marginRows = rows.filter(
        (row) => row.hasBid && row.premium !== null && row.premium > 0,
      );
      const enriched = new Map<string, EnrichedCandidate>(
        rows.map((row) => [
          row.id,
          {
            ...row,
            marginLoading: Boolean(row.hasBid && row.premium),
          },
        ]),
      );
      setCandidates([...enriched.values()]);
      if (marginRows.length === 0) {
        return;
      }
      const chunkSize = 5;

      for (let index = 0; index < marginRows.length; index += chunkSize) {
        const chunk = marginRows.slice(index, index + chunkSize);
        try {
          const response = await fetch("/api/screen/margin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountId: settings.accountId,
              items: chunk.map((row) => ({
                id: row.id,
                instrumentToken: row.instrumentToken,
                exchangeSegment: row.exchangeSegment,
                tradingSymbol: row.tradingSymbol,
                premium: row.premium,
                quantity: row.lotSize * row.lots,
              })),
            }),
          });
          if (response.status === 401) {
            onLoginRequired();
            return;
          }
          if (!response.ok) {
            for (const row of chunk) {
              const current = enriched.get(row.id);
              if (current) {
                enriched.set(row.id, {
                  ...current,
                  marginLoading: false,
                  marginError: "margin_failed",
                });
              }
            }
          } else {
            const payload = (await response.json()) as {
              margins: {
                id?: string;
                instrumentToken: string;
                margin: number | null;
                error?: string;
              }[];
            };
            for (const [resultIndex, result] of payload.margins.entries()) {
              const key = result.id ?? chunk[resultIndex]?.id;
              if (!key) {
                continue;
              }
              const current = enriched.get(key);
              if (!current || current.netPremium === null) {
                continue;
              }
              const annualizedReturnPct =
                result.margin === null
                  ? null
                  : calculateAnnualizedReturnPct(
                      current.netPremium,
                      result.margin,
                      current.calendarDaysLeft,
                    );
              enriched.set(key, {
                ...current,
                margin: result.margin,
                annualizedReturnPct,
                meetsReturn:
                  annualizedReturnPct === null
                    ? null
                    : annualizedReturnPct >= settings.returnMin,
                marginLoading: false,
                marginError: result.error,
              });
            }
          }
        } catch {
          for (const row of chunk) {
            const current = enriched.get(row.id);
            if (current) {
              enriched.set(row.id, {
                ...current,
                marginLoading: false,
                marginError: "margin_failed",
              });
            }
          }
        }
        setCandidates([...enriched.values()].sort((left, right) => {
          if (left.optionType !== right.optionType) {
            return left.optionType.localeCompare(right.optionType);
          }
          if (left.strike !== right.strike) {
            return left.strike - right.strike;
          }
          return left.fillIndex - right.fillIndex;
        }));
      }
    },
    [onLoginRequired, settings.accountId, settings.returnMin],
  );

  const runScreen = useCallback(async () => {
    if (!symbol || !selectedExpiry) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        symbol,
        expiry: selectedExpiry,
        spreadMin: String(settings.spreadMin),
        returnMin: String(settings.returnMin),
        side: settings.side,
        lots: String(settings.lots),
      });
      const response = await fetch(`/api/screen?${params.toString()}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        onLoginRequired();
        return;
      }
      if (!response.ok) {
        setError("Unable to load screener candidates.");
        return;
      }
      const payload = (await response.json()) as ScreenSnapshot;
      setSnapshot(payload);
      setCandidates(payload.candidates.map((row) => ({ ...row, marginLoading: true })));
      await loadMargins(payload.candidates);
    } catch {
      setError("Unable to reach the local server for screener data.");
    } finally {
      setLoading(false);
    }
  }, [loadMargins, onLoginRequired, selectedExpiry, settings, symbol]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const qualifyingCandidates = useMemo(
    () => candidates.filter((row) => row.meetsSpread && row.meetsReturn === true),
    [candidates],
  );
  const marginsPending = candidates.some((row) => row.marginLoading);

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
            <input
              type="number"
              value={settings.spreadMin}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  spreadMin: Number(event.target.value),
                }))
              }
              className="rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Min return % p.a.
            <input
              type="number"
              value={settings.returnMin}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  returnMin: Number(event.target.value),
                }))
              }
              className="rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Lots
            <input
              type="number"
              min={1}
              value={settings.lots}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  lots: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                }))
              }
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
          {marginsPending || loading
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
                    : loading || marginsPending
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
                    className={index % 2 === 0 ? "bg-white" : "bg-zinc-50"}
                  >
                    <td className="border-b border-zinc-100 px-3 py-2 font-medium">
                      {row.optionType === "CALL" ? "CE" : "PE"}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatNumber(row.strike)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatNumber(row.lots, 0)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatPercent(row.spreadPct)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2 font-semibold text-emerald-800">
                      {formatPercent(row.annualizedReturnPct)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatNumber(row.priceDiffInr)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatNumber(row.premium)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatNumber(row.netPremium, 0)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {row.marginError ? "—" : formatNumber(row.margin, 0)}
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
