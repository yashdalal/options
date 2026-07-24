import type { InvestmentReportRow } from "@/domain/types";

export type ThresholdPair = {
  spreadMin: number;
  returnMin: number;
};

export function thresholdsEqual(left: ThresholdPair, right: ThresholdPair): boolean {
  return left.spreadMin === right.spreadMin && left.returnMin === right.returnMin;
}

export function canApplyThresholds(run: ThresholdPair, draft: ThresholdPair): boolean {
  return draft.spreadMin >= run.spreadMin && draft.returnMin >= run.returnMin;
}

export function shouldFilterThresholdsOnly(
  run: ThresholdPair,
  applied: ThresholdPair,
  draft: ThresholdPair,
): boolean {
  return canApplyThresholds(run, draft) && !thresholdsEqual(applied, draft);
}

export function filterRowsByThresholds<T extends Pick<InvestmentReportRow, "spreadPct" | "annualizedReturnPct">>(
  rows: T[],
  thresholds: ThresholdPair,
): T[] {
  return rows.filter(
    (row) =>
      row.spreadPct >= thresholds.spreadMin &&
      (row.annualizedReturnPct ?? -Infinity) >= thresholds.returnMin,
  );
}
