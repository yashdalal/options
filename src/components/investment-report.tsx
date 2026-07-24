"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import { calendarDaysLeft, workingDaysLeft } from "@/domain/screening";
import type {
  BoardMeetingInfo,
  InvestmentReportProgress,
  InvestmentReportRow,
  ScreenMeta,
  ScreenSideFilter,
  UnderlyingPriceRanges,
} from "@/domain/types";
import { useScreenerSettings } from "@/hooks/use-screener-settings";
import { formatNumber, formatPercent, formatRupees } from "@/lib/format";
import {
  companiesForExpiry,
  companyChoiceLabel,
  filterCompanyChoices,
  listExpiriesForSelection,
  listUniqueExpiries,
  screenCompany,
} from "@/lib/screen-company";
import { runInvestmentReport } from "@/lib/investment-report-runner";
import { NumberInput } from "@/components/number-input";
import { PriceRangeBars, optionSideBadgeClass, optionSideTextClass } from "@/components/price-range-bars";

const REPORT_CONCURRENCY = 2;
const MAX_SELECTED_COMPANIES = 30;
const EMPTY_NAME_BY_UNDERLYING: Record<string, string> = {};

type ReportSortKey = "company" | "spread" | "return";
type ReportSortDir = "asc" | "desc";

type InvestmentReportProps = {
  onLoginRequired: () => void;
};

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

function formatBoardMeetingDate(dateIso: string): string {
  return formatExpiryLabel(dateIso);
}

function BoardMeetingCell({
  meeting,
  error,
}: {
  meeting: BoardMeetingInfo | undefined;
  error: string | undefined;
}) {
  if (error) {
    return (
      <span className="text-rose-700" title={error}>
        —
      </span>
    );
  }
  if (!meeting) {
    return <span className="text-zinc-400">—</span>;
  }
  const tooltip = [meeting.purpose, meeting.description].filter(Boolean).join(" — ");
  return (
    <span className="tabular-nums" title={tooltip || undefined}>
      {formatBoardMeetingDate(meeting.dateIso)}
    </span>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

const IDLE_PROGRESS: InvestmentReportProgress = {
  status: "idle",
  expiryIso: "",
  eligible: 0,
  skipped: 0,
  processed: 0,
  failed: 0,
  qualifyingCount: 0,
  currentSymbol: null,
};

export function InvestmentReport({ onLoginRequired }: InvestmentReportProps) {
  const [settings, setSettings] = useScreenerSettings();
  const [meta, setMeta] = useState<ScreenMeta | null>(null);
  const [expiryIso, setExpiryIso] = useState("");
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<InvestmentReportProgress>(IDLE_PROGRESS);
  const [rows, setRows] = useState<InvestmentReportRow[]>([]);
  const [priceRangesByCompany, setPriceRangesByCompany] = useState<
    Record<string, UnderlyingPriceRanges>
  >({});
  const [priceRangesErrorByCompany, setPriceRangesErrorByCompany] = useState<
    Record<string, string>
  >({});
  const [boardMeetingByCompany, setBoardMeetingByCompany] = useState<
    Record<string, BoardMeetingInfo>
  >({});
  const [boardMeetingErrorByCompany, setBoardMeetingErrorByCompany] = useState<
    Record<string, string>
  >({});
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [sortKey, setSortKey] = useState<ReportSortKey>("company");
  const [sortDir, setSortDir] = useState<ReportSortDir>("asc");
  const [helpOpen, setHelpOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runGenerationRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const companyPickerRef = useRef<HTMLDivElement | null>(null);
  const highlightOptionRef = useRef<HTMLButtonElement | null>(null);

  const expiries = useMemo(() => {
    if (!meta) {
      return [];
    }
    return listExpiriesForSelection(selectedCompanies, meta.expiriesByUnderlying);
  }, [meta, selectedCompanies]);

  const selectedExpiry = useMemo(() => {
    if (!expiries.length) {
      return "";
    }
    return expiries.includes(expiryIso) ? expiryIso : expiries[0];
  }, [expiries, expiryIso]);

  const eligibility = useMemo(() => {
    if (!meta || !selectedExpiry) {
      return { eligible: [] as string[], skipped: 0 };
    }
    return companiesForExpiry(
      meta.underlyings,
      meta.expiriesByUnderlying,
      selectedExpiry,
    );
  }, [meta, selectedExpiry]);

  const daysToExpiry = useMemo(() => {
    if (!selectedExpiry) {
      return { calendar: null as number | null, working: null as number | null };
    }
    return {
      calendar: calendarDaysLeft(selectedExpiry),
      working: workingDaysLeft(selectedExpiry),
    };
  }, [selectedExpiry]);

  const nameByUnderlying = meta?.nameByUnderlying ?? EMPTY_NAME_BY_UNDERLYING;

  const companyChoices = useMemo(
    () =>
      filterCompanyChoices(
        eligibility.eligible,
        selectedCompanies,
        companySearch,
        50,
        meta?.underlyings ?? eligibility.eligible,
        meta?.expiriesByUnderlying ?? {},
        selectedExpiry,
        nameByUnderlying,
      ),
    [
      companySearch,
      eligibility.eligible,
      meta?.expiriesByUnderlying,
      meta?.underlyings,
      nameByUnderlying,
      selectedCompanies,
      selectedExpiry,
    ],
  );
  const filteredCompanies = companyChoices.matches;

  function addCompany(symbol: string, expiryForSymbol?: string) {
    if (expiryForSymbol && expiryForSymbol !== selectedExpiry) {
      const nextSelection = selectedCompanies.includes(symbol)
        ? selectedCompanies
        : [...selectedCompanies, symbol]
            .sort((left, right) => left.localeCompare(right))
            .slice(0, MAX_SELECTED_COMPANIES);
      const shared =
        meta != null
          ? listExpiriesForSelection(nextSelection, meta.expiriesByUnderlying)
          : [];
      if (shared.length > 0) {
        const preferred = shared.includes(expiryForSymbol)
          ? expiryForSymbol
          : shared[0];
        setExpiryIso(preferred);
        setSelectedCompanies(nextSelection);
      } else {
        setExpiryIso(expiryForSymbol);
        setSelectedCompanies([symbol]);
      }
      setCompanySearch("");
      setHighlightIndex(0);
      setCompanyPickerOpen(false);
      return;
    }
    setSelectedCompanies((current) => {
      if (current.includes(symbol) || current.length >= MAX_SELECTED_COMPANIES) {
        return current;
      }
      return [...current, symbol].sort((left, right) => left.localeCompare(right));
    });
    setCompanySearch("");
    setHighlightIndex(0);
    setCompanyPickerOpen(true);
  }

  function removeCompany(symbol: string) {
    setSelectedCompanies((current) => current.filter((item) => item !== symbol));
  }

  function handleCompanySearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setCompanyPickerOpen(false);
      return;
    }

    if (
      selectedCompanies.length >= MAX_SELECTED_COMPANIES ||
      metaLoading ||
      running ||
      eligibility.eligible.length === 0
    ) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCompanyPickerOpen(true);
      setHighlightIndex((current) => {
        if (!companyPickerOpen || filteredCompanies.length === 0) {
          return 0;
        }
        return Math.min(current + 1, filteredCompanies.length - 1);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCompanyPickerOpen(true);
      setHighlightIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (!companyPickerOpen) {
        setCompanyPickerOpen(true);
        return;
      }
      const symbol =
        filteredCompanies[highlightIndex] ?? filteredCompanies[0] ?? null;
      if (symbol) {
        addCompany(symbol);
      }
    }
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!companyPickerRef.current?.contains(event.target as Node)) {
        setCompanyPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    highlightOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, companyPickerOpen]);

  useEffect(() => {
    if (!helpOpen) {
      return;
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setHelpOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [helpOpen]);

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
      const unique = listUniqueExpiries(payload.expiriesByUnderlying);
      setExpiryIso((current) => current || unique[0] || "");
    } catch {
      setError("Unable to reach the local server for report meta.");
    } finally {
      setMetaLoading(false);
    }
  }, [onLoginRequired]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount fetch
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const finishElapsed = useCallback(() => {
    if (startedAtRef.current !== null) {
      setElapsedMs(Date.now() - startedAtRef.current);
    }
  }, []);

  const cancelReport = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    finishElapsed();
    setProgress((current) =>
      current.status === "running"
        ? { ...current, status: "cancelled", currentSymbol: null }
        : current,
    );
  }, [finishElapsed]);

  const runReport = useCallback(async () => {
    if (!meta || !selectedExpiry || selectedCompanies.length === 0) {
      return;
    }

    const companies = selectedCompanies.slice(0, MAX_SELECTED_COMPANIES);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = ++runGenerationRef.current;
    const isCurrent = () => runId === runGenerationRef.current;
    startedAtRef.current = Date.now();
    setElapsedMs(null);

    setError(null);
    setRows([]);
    setPriceRangesByCompany({});
    setPriceRangesErrorByCompany({});
    setBoardMeetingByCompany({});
    setBoardMeetingErrorByCompany({});
    setProgress({
      status: "running",
      expiryIso: selectedExpiry,
      eligible: companies.length,
      skipped: eligibility.skipped,
      processed: 0,
      failed: 0,
      qualifyingCount: 0,
      currentSymbol: companies[0] ?? null,
    });

    const result = await runInvestmentReport({
      companies,
      concurrency: REPORT_CONCURRENCY,
      controller,
      skipped: eligibility.skipped,
      expiryIso: selectedExpiry,
      isCurrent,
      screenCompany: (symbol, signal) =>
        screenCompany({
          symbol,
          expiryIso: selectedExpiry,
          spreadMin: settings.spreadMin,
          returnMin: settings.returnMin,
          side: settings.side,
          lots: settings.lots,
          accountId: settings.accountId,
          signal,
        }),
      onProgress: (next) => {
        if (!isCurrent()) {
          return;
        }
        setProgress(next);
      },
      onRows: (next) => {
        if (!isCurrent()) {
          return;
        }
        setRows(next);
      },
      onCompanyMeta: (companyMeta) => {
        if (!isCurrent()) {
          return;
        }
        if (companyMeta.priceRanges) {
          setPriceRangesByCompany((current) => ({
            ...current,
            [companyMeta.symbol]: companyMeta.priceRanges!,
          }));
        }
        if (companyMeta.priceRangesError) {
          setPriceRangesErrorByCompany((current) => ({
            ...current,
            [companyMeta.symbol]: companyMeta.priceRangesError!,
          }));
        }
        if (companyMeta.boardMeeting) {
          setBoardMeetingByCompany((current) => ({
            ...current,
            [companyMeta.symbol]: companyMeta.boardMeeting!,
          }));
        }
        if (companyMeta.boardMeetingError) {
          setBoardMeetingErrorByCompany((current) => ({
            ...current,
            [companyMeta.symbol]: companyMeta.boardMeetingError!,
          }));
        }
      },
    });

    if (!isCurrent()) {
      return;
    }

    finishElapsed();
    if (result.reason === "auth") {
      onLoginRequired();
    } else if (result.reason === "unexpected") {
      setError("Report stopped due to an unexpected error.");
    }

    if (abortRef.current === controller) {
      abortRef.current = null;
    }
  }, [
    eligibility.skipped,
    finishElapsed,
    meta,
    onLoginRequired,
    selectedCompanies,
    selectedExpiry,
    settings,
  ]);

  const running = progress.status === "running";

  const sortedRows = useMemo(() => {
    const next = [...rows];
    next.sort((left, right) => {
      if (sortKey === "company") {
        const companyCmp = left.company.localeCompare(right.company);
        if (companyCmp !== 0) {
          return sortDir === "asc" ? companyCmp : -companyCmp;
        }
        if (left.optionType !== right.optionType) {
          return left.optionType.localeCompare(right.optionType);
        }
        const leftReturn = left.annualizedReturnPct ?? -Infinity;
        const rightReturn = right.annualizedReturnPct ?? -Infinity;
        return rightReturn - leftReturn;
      }

      if (sortKey === "spread") {
        const spreadCmp = left.spreadPct - right.spreadPct;
        if (spreadCmp !== 0) {
          return sortDir === "asc" ? spreadCmp : -spreadCmp;
        }
        const companyCmp = left.company.localeCompare(right.company);
        if (companyCmp !== 0) {
          return companyCmp;
        }
        return left.optionType.localeCompare(right.optionType);
      }

      const leftReturn = left.annualizedReturnPct ?? -Infinity;
      const rightReturn = right.annualizedReturnPct ?? -Infinity;
      const returnCmp = leftReturn - rightReturn;
      if (returnCmp !== 0) {
        return sortDir === "asc" ? returnCmp : -returnCmp;
      }
      const companyCmp = left.company.localeCompare(right.company);
      if (companyCmp !== 0) {
        return companyCmp;
      }
      return left.optionType.localeCompare(right.optionType);
    });
    return next;
  }, [rows, sortDir, sortKey]);

  function toggleSort(nextKey: ReportSortKey) {
    if (sortKey === nextKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "company" ? "asc" : "desc");
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-zinc-900">Investment Report</h1>
            <p className="text-sm text-zinc-600">
              Screen a short company list and list every option that meets min spread and min
              annualized return.{" "}
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600"
              >
                How it works
              </button>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {running ? (
              <button
                type="button"
                onClick={cancelReport}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runReport()}
                disabled={
                  metaLoading || !selectedExpiry || selectedCompanies.length === 0
                }
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                Run report
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <div className="relative sm:col-span-2" ref={companyPickerRef}>
            <label className="flex flex-col gap-1 text-sm text-zinc-700">
              Companies ({selectedCompanies.length}/{MAX_SELECTED_COMPANIES})
              <input
                type="search"
                value={companySearch}
                onChange={(event) => {
                  setCompanySearch(event.target.value);
                  setCompanyPickerOpen(true);
                  setHighlightIndex(0);
                }}
                onFocus={() => {
                  setCompanyPickerOpen(true);
                  setHighlightIndex(0);
                }}
                onKeyDown={handleCompanySearchKeyDown}
                placeholder={
                  selectedCompanies.length >= MAX_SELECTED_COMPANIES
                    ? `Max ${MAX_SELECTED_COMPANIES} selected`
                    : "Search and add…"
                }
                disabled={
                  metaLoading ||
                  running ||
                  eligibility.eligible.length === 0 ||
                  selectedCompanies.length >= MAX_SELECTED_COMPANIES
                }
                className="rounded-lg border border-zinc-300 px-2 py-1.5"
                aria-controls="company-picker-results"
                aria-autocomplete="list"
              />
            </label>
            {companyPickerOpen &&
            !metaLoading &&
            eligibility.eligible.length > 0 &&
            selectedCompanies.length < MAX_SELECTED_COMPANIES ? (
              <div
                id="company-picker-results"
                role="listbox"
                className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg"
              >
                {filteredCompanies.length === 0 &&
                companyChoices.otherExpiryMatches.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-zinc-500">
                    {companySearch.trim()
                      ? `No companies match “${companySearch.trim()}” for this expiry.`
                      : "All matching companies are already selected."}
                  </p>
                ) : (
                  <>
                    {filteredCompanies.map((symbol, index) => {
                      const active = index === highlightIndex;
                      const name = nameByUnderlying[symbol];
                      return (
                        <button
                          key={symbol}
                          type="button"
                          role="option"
                          aria-selected={active}
                          ref={active ? highlightOptionRef : null}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() => addCompany(symbol)}
                          className={`block w-full px-3 py-2 text-left text-sm ${
                            active
                              ? "bg-zinc-100 text-zinc-900"
                              : "text-zinc-800 hover:bg-zinc-50"
                          }`}
                        >
                          <span className="font-medium">{symbol}</span>
                          {name ? (
                            <span className="mt-0.5 block text-xs text-zinc-500">
                              {name}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {companyChoices.otherExpiryMatches.length > 0 ? (
                      <div className="border-t border-zinc-100">
                        <p className="px-3 py-2 text-xs font-medium text-zinc-500">
                          Available on other expiries
                        </p>
                        {companyChoices.otherExpiryMatches.map((item) => {
                          const keepsSelection =
                            selectedCompanies.length > 0 &&
                            selectedCompanies.every((symbol) =>
                              (meta?.expiriesByUnderlying[symbol] ?? []).includes(
                                item.expiryIso,
                              ),
                            );
                          const name = nameByUnderlying[item.symbol];
                          return (
                            <button
                              key={`${item.symbol}-${item.expiryIso}`}
                              type="button"
                              onClick={() => addCompany(item.symbol, item.expiryIso)}
                              className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50"
                            >
                              <span className="font-medium">{item.symbol}</span>
                              {name ? (
                                <span className="mt-0.5 block text-xs text-zinc-500">
                                  {name}
                                </span>
                              ) : null}
                              <span className="mt-0.5 block text-xs text-zinc-500">
                                {keepsSelection
                                  ? `${formatExpiryLabel(item.expiryIso)} — keep current selection`
                                  : selectedCompanies.length > 0
                                    ? `${formatExpiryLabel(item.expiryIso)} · replace selection`
                                    : formatExpiryLabel(item.expiryIso)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {companyChoices.truncated ? (
                      <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">
                        Showing first {filteredCompanies.length} of {companyChoices.total}.
                        Type to search all.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Expiry
            <select
              value={selectedExpiry}
              onChange={(event) => {
                setExpiryIso(event.target.value);
                setCompanySearch("");
                setCompanyPickerOpen(false);
                setHighlightIndex(0);
              }}
              disabled={metaLoading || running || !expiries.length}
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
              disabled={running}
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
              disabled={running}
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
              disabled={running}
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
              disabled={running}
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
              disabled={running}
              className="rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
        </div>

        {selectedCompanies.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectedCompanies.map((symbol) => (
              <span
                key={symbol}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-sm text-zinc-800"
                title={companyChoiceLabel(symbol, nameByUnderlying)}
              >
                {symbol}
                <button
                  type="button"
                  onClick={() => removeCompany(symbol)}
                  disabled={running}
                  className="rounded-full px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 disabled:opacity-50"
                  aria-label={`Remove ${companyChoiceLabel(symbol, nameByUnderlying)}`}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setSelectedCompanies([])}
              disabled={running}
              className="text-sm text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        ) : null}
      </header>

      {helpOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label="Close help panel"
            className="absolute inset-0 bg-zinc-900/25"
            onClick={() => setHelpOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-help-title"
            className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <h2 id="report-help-title" className="text-base font-semibold text-zinc-900">
                Report help
              </h2>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
            <div className="flex-1 space-y-8 overflow-y-auto px-4 py-4">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900">How this report works</h3>
                <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600">
                  <li>
                    Pick companies first or pick an expiry first. With companies selected, the
                    expiry list only shows dates that{" "}
                    <span className="font-medium text-zinc-800">every</span> selected name lists —
                    so changing expiry never drops names from the selection.
                  </li>
                  <li>
                    You can select up to{" "}
                    <span className="font-medium text-zinc-800">{MAX_SELECTED_COMPANIES}</span>{" "}
                    companies. Only names that list the chosen expiry can be added for that run.
                  </li>
                  <li>
                    An option only qualifies if it meets both the minimum spread and the minimum
                    annualized return after sell charges and broker margin. Every qualifying
                    strike is shown.
                  </li>
                </ul>
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900">Calculation formulas</h3>
                <dl className="grid gap-3 text-sm">
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium text-zinc-800">Spread % (CE)</dt>
                    <dd className="font-mono text-xs text-zinc-600">
                      ((strike − spot) / spot) × 100
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium text-zinc-800">Spread % (PE)</dt>
                    <dd className="font-mono text-xs text-zinc-600">
                      ((spot − strike) / spot) × 100
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium text-zinc-800">Diff ₹</dt>
                    <dd className="font-mono text-xs text-zinc-600">|strike − spot|</dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium text-zinc-800">Total net premium</dt>
                    <dd className="font-mono text-xs text-zinc-600">
                      premium turnover − sell charges
                    </dd>
                    <dd className="text-xs text-zinc-500">
                      Charges: ₹10 brokerage/order + STT 0.15% + exchange ~0.03503% + SEBI
                      0.0001%; GST 18% on (brokerage + exchange + SEBI)
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium text-zinc-800">Ann. return %</dt>
                    <dd className="font-mono text-xs text-zinc-600">
                      (net premium / margin) × (365 / calendar days) × 100
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium text-zinc-800">Bid / Margin</dt>
                    <dd className="text-xs text-zinc-600">
                      Bid from order-book buy depth; margin from broker check-margin API
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </aside>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Total days to expiry
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {daysToExpiry.calendar ?? "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Working days to expiry
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {daysToExpiry.working ?? "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Selected
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {selectedCompanies.length}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Processed
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {progress.status === "idle"
              ? "—"
              : `${progress.processed} / ${progress.eligible}`}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Failed
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {progress.status === "idle" ? "—" : progress.failed}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Qualifying
          </span>
          <span className="text-lg font-semibold text-emerald-800 tabular-nums">
            {progress.status === "idle" ? "—" : progress.qualifyingCount}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Duration
          </span>
          <span className="text-lg font-semibold text-zinc-900 tabular-nums">
            {elapsedMs === null ? "—" : formatDuration(elapsedMs)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 sm:ml-auto">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Status
          </span>
          <span className="text-base font-medium text-zinc-800">
            {progress.status === "idle"
              ? "Ready"
              : progress.status === "running"
                ? `Screening ${progress.currentSymbol ?? "…"}`
                : progress.status === "cancelled"
                  ? "Cancelled"
                  : progress.status === "error"
                    ? "Error"
                    : "Completed"}
          </span>
        </div>
      </div>

      <p className="text-sm text-zinc-600">
        {metaLoading
          ? "Loading companies…"
          : running
            ? `Scanning selected companies for ${formatExpiryLabel(selectedExpiry)}. Qualifying rows appear as each company finishes.`
            : progress.status === "completed"
              ? `${rows.length} options meet min spread and min return across ${progress.eligible - progress.failed} companies.${elapsedMs === null ? "" : ` Report took ${formatDuration(elapsedMs)} to generate.`}`
              : progress.status === "cancelled"
                ? `Stopped after ${progress.processed} companies. ${rows.length} qualifying options kept.${elapsedMs === null ? "" : ` Ran for ${formatDuration(elapsedMs)}.`}`
                : progress.status === "error"
                  ? `Stopped after ${progress.processed} companies due to an error. ${rows.length} qualifying options kept.${elapsedMs === null ? "" : ` Ran for ${formatDuration(elapsedMs)}.`}`
                  : selectedCompanies.length > 0 && expiries.length === 0
                    ? "No shared expiry across the selected companies. Remove a name or clear the list to continue."
                    : selectedCompanies.length > 0
                      ? `Ready to screen ${selectedCompanies.length} selected compan${selectedCompanies.length === 1 ? "y" : "ies"} on ${formatExpiryLabel(selectedExpiry)}.`
                      : `Pick up to ${MAX_SELECTED_COMPANIES} companies, then run the report.`}
      </p>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[inset_0_-1px_0_#d4d4d8]">
            <tr className="text-left text-zinc-700">
              {(
                [
                  { heading: "Setup", sort: "company" as const },
                  { heading: "Spot" },
                  { heading: "Strike" },
                  { heading: "Lots" },
                  { heading: "Spread %", sort: "spread" as const },
                  { heading: "Ann. return %", sort: "return" as const },
                  { heading: "Diff ₹", title: "|strike − spot|" },
                  { heading: "Bid" },
                  { heading: "Net premium" },
                  { heading: "Margin" },
                  { heading: "Board meeting" },
                ] satisfies { heading: string; sort?: ReportSortKey; title?: string }[]
              ).map(({ heading, sort, title }) => {
                const active = Boolean(sort && sortKey === sort);
                return (
                  <th
                    key={heading}
                    title={title}
                    aria-sort={
                      sort
                        ? active
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    className="border-b border-zinc-200 px-3 py-2 font-semibold whitespace-nowrap"
                  >
                    {sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(sort)}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors ${
                          active
                            ? "bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300"
                            : "text-zinc-700 underline decoration-zinc-400 decoration-dotted underline-offset-4 hover:bg-zinc-100 hover:text-zinc-900"
                        }`}
                      >
                        {heading}
                        <span
                          className={`font-normal ${active ? "text-zinc-700" : "text-zinc-400"}`}
                          aria-hidden="true"
                        >
                          {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    ) : heading === "Spot" ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-700">
                        <span className="h-2 w-2 rounded-full bg-zinc-900" aria-hidden="true" />
                        Spot
                      </span>
                    ) : heading === "Strike" ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-700">
                        <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
                        Strike
                      </span>
                    ) : (
                      <span className="text-zinc-700">{heading}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-zinc-500">
                  {metaLoading
                    ? "Loading companies…"
                    : running
                      ? "Screening companies…"
                      : progress.status === "completed" || progress.status === "cancelled"
                        ? "No options meet both min spread and min return %."
                        : "Pick companies and run a report."}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`${index % 2 === 0 ? "bg-white" : "bg-zinc-50"} font-medium ${optionSideTextClass(row.optionType)}`}
                >
                  <td className="border-b border-zinc-100 px-3 py-2.5">
                    <div className="flex min-w-[16rem] flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{row.company}</span>
                        <span
                          className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${optionSideBadgeClass(row.optionType)}`}
                        >
                          {row.optionType === "CALL" ? "Call" : "Put"}
                        </span>
                      </div>
                      <PriceRangeBars
                        ranges={priceRangesByCompany[row.company]}
                        spot={row.spot}
                        strike={row.strike}
                        error={priceRangesErrorByCompany[row.company] ?? null}
                        compact
                      />
                    </div>
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-900" aria-hidden="true" />
                      {formatRupees(row.spot)}
                    </span>
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" aria-hidden="true" />
                      {formatRupees(row.strike)}
                    </span>
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
                    {formatRupees(row.priceDiffInr)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatRupees(row.premium)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatRupees(row.netPremium, 0)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2 tabular-nums">
                    {formatRupees(row.margin, 0)}
                  </td>
                  <td className="border-b border-zinc-100 px-3 py-2.5 whitespace-nowrap">
                    <BoardMeetingCell
                      meeting={boardMeetingByCompany[row.company]}
                      error={boardMeetingErrorByCompany[row.company]}
                    />
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
