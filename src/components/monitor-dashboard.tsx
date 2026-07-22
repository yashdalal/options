"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MonitorSnapshot, ReportRow, ReportSide } from "@/domain/types";
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

function formatPosition(lots: number, shares: number): string {
  return `${formatNumber(lots, 0)} (${formatNumber(shares, 0)})`;
}

function optionCellClass(emphasized: boolean): string {
  return `border-b border-zinc-100 px-3 py-2 whitespace-nowrap${emphasized ? " font-semibold text-red-600" : ""}`;
}

function accountBadgeClass(accountId: string): string {
  if (accountId === "prakash") {
    return "bg-sky-100 text-sky-900";
  }
  if (accountId === "gopa") {
    return "bg-violet-100 text-violet-900";
  }
  return "bg-rose-100 text-rose-900";
}

function rowKey(row: ReportRow, index: number): string {
  return `${row.company}-${row.call?.strike ?? "x"}-${row.put?.strike ?? "x"}-${index}`;
}

function SideCells({
  side,
  highlighted,
}: {
  side: ReportSide | null;
  highlighted: boolean;
}) {
  return (
    <>
      <td className={optionCellClass(highlighted)}>
        {side ? formatNumber(side.strike, 2) : "—"}
      </td>
      <td className={optionCellClass(highlighted)}>
        {side ? formatPosition(side.lots, side.shares) : "—"}
      </td>
      <td className={optionCellClass(highlighted)}>{formatPercent(side?.pctNear)}</td>
      <td className={optionCellClass(highlighted)}>{formatNumber(side?.inrNear)}</td>
    </>
  );
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
  const [thresholdInput, setThresholdInput] = useState(() =>
    String(readStoredThreshold(highlightDefault)),
  );
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    window.localStorage.setItem(THRESHOLD_KEY, String(threshold));
  }, [threshold]);

  function commitThresholdInput(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      setThreshold(parsed);
      setThresholdInput(String(parsed));
      return;
    }
    setThresholdInput(String(threshold));
  }

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

  useEffect(() => {
    // Reset expanded rows when the visible expiry snapshot changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional view reset
    setExpandedRows(new Set());
  }, [selectedExpiry, snapshot?.generatedAt]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  function toggleRow(key: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-900">Near Expiry Monitor</h1>
            <p className="text-sm text-zinc-600">
              Combined report for Prakash, Gopa, and HUF. Spot uses NSE last traded price.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
            <label
              className="flex items-center gap-1.5 text-sm text-zinc-700"
              title="Highlight rows when Call/Put % Near is below this value"
            >
              <span className="whitespace-nowrap text-zinc-600">Within</span>
              <input
                type="text"
                inputMode="decimal"
                value={thresholdInput}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) {
                    return;
                  }
                  setThresholdInput(raw);
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setThreshold(parsed);
                  }
                }}
                onBlur={() => commitThresholdInput(thresholdInput)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitThresholdInput(thresholdInput);
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Highlight when within this percent of spot"
                className="w-16 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-center text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-200"
              />
              <span className="whitespace-nowrap text-zinc-600">% of spot</span>
            </label>
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
        </div>
      </header>

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
        <span>Report {snapshot?.reportDate ?? "—"}</span>
        <span>
          Positions: {snapshot?.optionPositionCount ?? 0} · Prices:{" "}
          {snapshot?.downloadedPriceCount ?? 0}
        </span>
        {snapshot?.accountSummaries.map((summary) => (
          <span
            key={summary.accountId}
            className={`rounded-full px-2 py-0.5 font-medium ${accountBadgeClass(summary.accountId)}`}
          >
            {summary.accountLabel}: {summary.optionPositionCount}
          </span>
        ))}
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

      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Expiry
        </div>
        <div
          className="flex gap-2 overflow-x-auto"
          role="tablist"
          aria-label="Expiry date"
        >
          {snapshot?.groups.map((group) => {
            const selected = activeGroup?.expiryIso === group.expiryIso;
            return (
              <button
                key={group.expiryIso}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedExpiry(group.expiryIso)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                  selected
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                {group.expiryLabel}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[inset_0_-1px_0_#d4d4d8]">
            <tr className="text-left text-zinc-700">
              {[
                "",
                "Company",
                "Spot",
                "Call Strike",
                "Call Lots (Shares)",
                "Call % Near",
                "Call INR Near",
                "Put Strike",
                "Put Lots (Shares)",
                "Put % Near",
                "Put INR Near",
              ].map((heading) => (
                <th
                  key={heading || "expand"}
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
                <td colSpan={11} className="px-3 py-8 text-center text-zinc-500">
                  No open option positions for this expiry.
                </td>
              </tr>
            ) : (
              activeGroup.rows.flatMap((row, index) => {
                const key = rowKey(row, index);
                const expanded = expandedRows.has(key);
                const callHighlighted = shouldHighlightSide(row.call?.pctNear, threshold);
                const putHighlighted = shouldHighlightSide(row.put?.pctNear, threshold);
                const highlighted = callHighlighted || putHighlighted;
                const canExpand = row.details.length > 0;
                const summaryRow = (
                  <tr
                    key={key}
                    className={`${highlighted ? "bg-amber-100" : index % 2 === 0 ? "bg-white" : "bg-zinc-50"}${canExpand ? " cursor-pointer hover:bg-zinc-100" : ""}`}
                    onClick={() => {
                      if (canExpand) {
                        toggleRow(key);
                      }
                    }}
                    aria-expanded={canExpand ? expanded : undefined}
                  >
                    <td className="border-b border-zinc-100 px-3 py-2 text-zinc-500">
                      {canExpand ? (expanded ? "▾" : "▸") : ""}
                    </td>
                    <td
                      className={`border-b border-zinc-100 px-3 py-2 font-medium${highlighted ? " text-red-600" : " text-zinc-900"}`}
                    >
                      {row.company}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      {formatNumber(row.spot)}
                    </td>
                    <SideCells side={row.call} highlighted={callHighlighted} />
                    <SideCells side={row.put} highlighted={putHighlighted} />
                  </tr>
                );

                if (!expanded) {
                  return [summaryRow];
                }

                const detailRows = row.details.map((detail) => {
                  const detailCallHighlighted = shouldHighlightSide(
                    detail.call?.pctNear,
                    threshold,
                  );
                  const detailPutHighlighted = shouldHighlightSide(
                    detail.put?.pctNear,
                    threshold,
                  );
                  return (
                    <tr
                      key={`${key}-${detail.accountId}`}
                      className="bg-zinc-50/80"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <td className="border-b border-zinc-100 px-3 py-2" />
                      <td className="border-b border-zinc-100 px-3 py-2 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${accountBadgeClass(detail.accountId)}`}
                        >
                          {detail.accountLabel}
                        </span>
                      </td>
                      <td className="border-b border-zinc-100 px-3 py-2 text-zinc-400">
                        {formatNumber(row.spot)}
                      </td>
                      <SideCells side={detail.call} highlighted={detailCallHighlighted} />
                      <SideCells side={detail.put} highlighted={detailPutHighlighted} />
                    </tr>
                  );
                });

                return [summaryRow, ...detailRows];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
