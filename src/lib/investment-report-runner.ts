import type {
  BoardMeetingInfo,
  InvestmentReportProgress,
  InvestmentReportRow,
  ScreenCoverage,
  UnderlyingPriceRanges,
} from "@/domain/types";
import {
  runPool as defaultRunPool,
  type ScreenCompanyResult,
} from "@/lib/screen-company";

export type ReportTerminalStatus = "completed" | "cancelled" | "error";

export type ReportRunResult = {
  status: ReportTerminalStatus;
  reason?: "auth" | "unexpected";
  processed: number;
  failed: number;
  rows: InvestmentReportRow[];
};

export type ReportCompanyMeta = {
  symbol: string;
  priceRanges?: UnderlyingPriceRanges;
  priceRangesError?: string;
  boardMeeting?: BoardMeetingInfo;
  boardMeetingError?: string;
  coverage?: ScreenCoverage | null;
};

export type AggregatedScreenCoverage = {
  companies: number;
  nearBand: number;
  quoted: number;
  noBid: number;
  belowSpreadMin: number;
  shown: number;
  meetsSpreadMinWithBid: number;
};

export function aggregateScreenCoverage(
  coverages: Array<ScreenCoverage | null | undefined>,
): AggregatedScreenCoverage {
  const totals: AggregatedScreenCoverage = {
    companies: 0,
    nearBand: 0,
    quoted: 0,
    noBid: 0,
    belowSpreadMin: 0,
    shown: 0,
    meetsSpreadMinWithBid: 0,
  };
  for (const coverage of coverages) {
    if (!coverage) {
      continue;
    }
    totals.companies += 1;
    totals.nearBand += coverage.nearBand;
    totals.quoted += coverage.quoted;
    totals.noBid += coverage.noBid;
    totals.belowSpreadMin += coverage.belowSpreadMin;
    totals.shown += coverage.shown;
    totals.meetsSpreadMinWithBid += coverage.meetsSpreadMinWithBid;
  }
  return totals;
}

export function describeEmptyReportReason(
  coverage: AggregatedScreenCoverage | null,
): string {
  if (!coverage || coverage.companies === 0) {
    return "No options meet both min spread and min return %.";
  }
  if (coverage.nearBand === 0) {
    return "No options in the near spread band for the selected companies and side.";
  }
  if (coverage.shown === 0 && coverage.noBid > 0) {
    const optionLabel = coverage.noBid === 1 ? "option" : "options";
    const companyLabel = coverage.companies === 1 ? "company" : "companies";
    return `No buy quotes on ${coverage.noBid} screened ${optionLabel} across ${coverage.companies} ${companyLabel}. Market may be closed.`;
  }
  if (coverage.shown === 0 && coverage.belowSpreadMin > 0) {
    return "Quoted options are below the min spread %.";
  }
  return "No options meet both min spread and min return %.";
}

export type RunInvestmentReportParams = {
  companies: string[];
  concurrency: number;
  controller: AbortController;
  skipped: number;
  expiryIso: string;
  isCurrent: () => boolean;
  screenCompany: (
    symbol: string,
    signal: AbortSignal,
  ) => Promise<ScreenCompanyResult>;
  onProgress: (progress: InvestmentReportProgress) => void;
  onRows: (rows: InvestmentReportRow[]) => void;
  onCompanyMeta: (meta: ReportCompanyMeta) => void;
  runPool?: typeof defaultRunPool;
};

export function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  return (err as { name?: string }).name === "AbortError";
}

function isAuthError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    (err as { kind?: string }).kind === "auth"
  );
}

function compareReportRows(
  left: InvestmentReportRow,
  right: InvestmentReportRow,
): number {
  if (left.company !== right.company) {
    return left.company.localeCompare(right.company);
  }
  if (left.optionType !== right.optionType) {
    return left.optionType.localeCompare(right.optionType);
  }
  const leftReturn = left.annualizedReturnPct ?? -Infinity;
  const rightReturn = right.annualizedReturnPct ?? -Infinity;
  if (leftReturn !== rightReturn) {
    return rightReturn - leftReturn;
  }
  return left.strike - right.strike;
}

export async function runInvestmentReport(
  params: RunInvestmentReportParams,
): Promise<ReportRunResult> {
  const {
    companies,
    concurrency,
    controller,
    skipped,
    expiryIso,
    isCurrent,
    screenCompany,
    onProgress,
    onRows,
    onCompanyMeta,
    runPool = defaultRunPool,
  } = params;

  const collected: InvestmentReportRow[] = [];
  let processed = 0;
  let failed = 0;
  let fatalReason: "auth" | "unexpected" | null = null;

  const emitProgress = (
    patch: Partial<InvestmentReportProgress> &
      Pick<InvestmentReportProgress, "status">,
  ) => {
    if (!isCurrent()) {
      return;
    }
    onProgress({
      status: patch.status,
      expiryIso,
      eligible: companies.length,
      skipped,
      processed: patch.processed ?? processed,
      failed: patch.failed ?? failed,
      qualifyingCount: patch.qualifyingCount ?? collected.length,
      currentSymbol:
        patch.currentSymbol === undefined ? null : patch.currentSymbol,
    });
  };

  const finishWithError = (reason: "auth" | "unexpected"): ReportRunResult => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    emitProgress({
      status: "error",
      currentSymbol: null,
      processed,
      failed,
      qualifyingCount: collected.length,
    });
    return {
      status: "error",
      reason,
      processed,
      failed,
      rows: collected,
    };
  };

  try {
    await runPool(
      companies,
      concurrency,
      async (symbol) => {
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (!isCurrent()) {
          throw new DOMException("Aborted", "AbortError");
        }

        emitProgress({
          status: "running",
          currentSymbol: symbol,
          processed,
          failed,
          qualifyingCount: collected.length,
        });

        try {
          const result = await screenCompany(symbol, controller.signal);
          if (!isCurrent() || controller.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          onCompanyMeta({
            symbol,
            priceRanges: result.snapshot.priceRanges ?? undefined,
            priceRangesError: result.snapshot.priceRangesError ?? undefined,
            boardMeeting: result.snapshot.boardMeeting ?? undefined,
            boardMeetingError: result.snapshot.boardMeetingError ?? undefined,
            coverage: result.snapshot.coverage,
          });

          const nextRows = result.qualifying.map((candidate) => ({
            ...candidate,
            spot: candidate.spot,
          }));
          collected.push(...nextRows);
          collected.sort(compareReportRows);
          if (isCurrent()) {
            onRows([...collected]);
          }
        } catch (err) {
          if (isAuthError(err)) {
            fatalReason = "auth";
            if (!controller.signal.aborted) {
              controller.abort();
            }
            throw err;
          }
          if (isAbortError(err)) {
            throw err;
          }
          failed += 1;
        } finally {
          processed += 1;
          if (isCurrent() && !controller.signal.aborted) {
            emitProgress({
              status: "running",
              currentSymbol: symbol,
              processed,
              failed,
              qualifyingCount: collected.length,
            });
          }
        }
      },
      controller.signal,
    );

    if (controller.signal.aborted || !isCurrent()) {
      if (fatalReason) {
        return finishWithError(fatalReason);
      }
      return {
        status: "cancelled",
        processed,
        failed,
        rows: collected,
      };
    }

    emitProgress({
      status: "completed",
      currentSymbol: null,
      processed,
      failed,
      qualifyingCount: collected.length,
    });

    return {
      status: "completed",
      processed,
      failed,
      rows: collected,
    };
  } catch (err) {
    if (isAuthError(err) || fatalReason === "auth") {
      return finishWithError("auth");
    }

    if (isAbortError(err)) {
      if (fatalReason) {
        return finishWithError(fatalReason);
      }
      return {
        status: "cancelled",
        processed,
        failed,
        rows: collected,
      };
    }

    fatalReason = "unexpected";
    return finishWithError("unexpected");
  }
}
