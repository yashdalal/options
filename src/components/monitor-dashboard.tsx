"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MonitorSnapshot } from "@/domain/types";
import { shouldHighlightSide } from "@/domain/proximity";

const THRESHOLD_KEY = "near_expiry_highlight_threshold";

type MonitorDashboardProps = {
  highlightDefault: number;
  onLogout: () => void;
  onLoginRequired: () => void;
};

function readStoredThreshold(fallback: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(THRESHOLD_KEY);
  if (!stored) {
    return fallback;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function optionCellClass(emphasized: boolean): string {
  return `border-b border-zinc-100 px-3 py-2${emphasized ? " font-semibold text-red-600" : ""}`;
}

export function MonitorDashboard({
  highlightDefault,
  onLogout,
  onLoginRequired,
}: MonitorDashboardProps) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(() => readStoredThreshold(highlightDefault));
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);

  useEffect(() => {
    window.localStorage.setItem(THRESHOLD_KEY, String(threshold));
  }, [threshold]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/monitor", { cache: "no-store" });
      if (response.status === 401) {
        onLoginRequired();
        return;
      }
      if (!response.ok) {
        setError("Refresh failed. Showing last successful snapshot if available.");
        setStale(true);
        return;
      }
      const payload = (await response.json()) as MonitorSnapshot;
      setSnapshot(payload);
      setStale(false);
      setSelectedExpiry((current) => current ?? payload.groups[0]?.expiryIso ?? null);
      setNextRefreshAt(Date.now() + 60_000);
    } catch {
      setError("Refresh failed. Showing last successful snapshot if available.");
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [onLoginRequired]);

  useEffect(() => {
    // Initial monitor snapshot fetch after authenticated shell mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount fetch
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  const activeGroup = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return (
      snapshot.groups.find((group) => group.expiryIso === selectedExpiry) ??
      snapshot.groups[0] ??
      null
    );
  }, [snapshot, selectedExpiry]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Near Expiry Monitor</h1>
          <p className="text-sm text-zinc-600">
            Spot uses latest completed NSE close. Refresh is manual or every 60 seconds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto refresh
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Logout
          </button>
        </div>
      </header>

      <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Highlight Threshold (%)</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Report Date</span>
          <div className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-800">
            {snapshot?.reportDate ?? "—"}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Expiry</span>
          <div className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-800">
            {activeGroup?.expiryLabel ?? "—"}
          </div>
        </div>
      </section>

      {(error || stale) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error ?? "Snapshot may be stale."}
        </div>
      )}

      {snapshot?.missingSymbols.length ? (
        <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p className="font-medium">Could not download prices for:</p>
          <p className="mt-1">{snapshot.missingSymbols.join(", ")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>
          Positions: {snapshot?.optionPositionCount ?? 0} · Prices:{" "}
          {snapshot?.downloadedPriceCount ?? 0}
        </span>
        <span>
          Updated:{" "}
          {snapshot
            ? new Date(snapshot.generatedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })
            : "—"}
        </span>
        {autoRefresh && nextRefreshAt ? (
          <span>Next refresh around {new Date(nextRefreshAt).toLocaleTimeString("en-IN")}</span>
        ) : null}
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {snapshot?.groups.map((group) => (
          <button
            key={group.expiryIso}
            type="button"
            onClick={() => setSelectedExpiry(group.expiryIso)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              activeGroup?.expiryIso === group.expiryIso
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {group.expiryLabel}
          </button>
        ))}
      </div>

      <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-zinc-50">
            <tr className="text-left text-zinc-700">
              {[
                "Company",
                "Spot",
                "Call Strike",
                "Call % Near",
                "Call INR Near",
                "Put Strike",
                "Put % Near",
                "Put INR Near",
              ].map((heading) => (
                <th
                  key={heading}
                  className="border-b border-zinc-200 px-3 py-2 font-semibold whitespace-nowrap"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!activeGroup || activeGroup.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">
                  No open option positions for this expiry.
                </td>
              </tr>
            ) : (
              activeGroup.rows.map((row, index) => {
                const callHighlighted = shouldHighlightSide(row.call?.pctNear, threshold);
                const putHighlighted = shouldHighlightSide(row.put?.pctNear, threshold);
                const highlighted = callHighlighted || putHighlighted;
                return (
                  <tr
                    key={`${row.company}-${row.call?.strike ?? "x"}-${row.put?.strike ?? "x"}-${index}`}
                    className={`${highlighted ? "bg-amber-100" : index % 2 === 0 ? "bg-white" : "bg-zinc-50"}`}
                  >
                    <td
                      className={`border-b border-zinc-100 px-3 py-2 font-medium${highlighted ? " text-red-600" : " text-zinc-900"}`}
                    >
                      {row.company}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">{formatNumber(row.spot)}</td>
                    <td className={optionCellClass(callHighlighted)}>
                      {row.call ? formatNumber(row.call.strike, 2) : "—"}
                    </td>
                    <td className={optionCellClass(callHighlighted)}>
                      {formatPercent(row.call?.pctNear)}
                    </td>
                    <td className={optionCellClass(callHighlighted)}>
                      {formatNumber(row.call?.inrNear)}
                    </td>
                    <td className={optionCellClass(putHighlighted)}>
                      {row.put ? formatNumber(row.put.strike, 2) : "—"}
                    </td>
                    <td className={optionCellClass(putHighlighted)}>
                      {formatPercent(row.put?.pctNear)}
                    </td>
                    <td className={optionCellClass(putHighlighted)}>
                      {formatNumber(row.put?.inrNear)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
