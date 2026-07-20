import type { OptionType } from "./types";

export function calculateInrNear(
  optionType: OptionType,
  strike: number,
  spot: number,
): number {
  return optionType === "CALL" ? strike - spot : spot - strike;
}

export function calculatePctNear(inrNear: number, spot: number): number | null {
  if (!Number.isFinite(spot) || spot === 0) {
    return null;
  }
  return (Math.abs(inrNear) / spot) * 100;
}

export function calculateProximity(
  optionType: OptionType,
  strike: number,
  spot: number | null,
): { inrNear: number | null; pctNear: number | null } {
  if (spot === null || !Number.isFinite(spot) || spot <= 0) {
    return { inrNear: null, pctNear: null };
  }
  const inrNear = calculateInrNear(optionType, strike, spot);
  return {
    inrNear,
    pctNear: calculatePctNear(inrNear, spot),
  };
}

export function shouldHighlightRow(
  callPctNear: number | null | undefined,
  putPctNear: number | null | undefined,
  threshold: number,
): boolean {
  const callHit =
    typeof callPctNear === "number" && Number.isFinite(callPctNear) && callPctNear < threshold;
  const putHit =
    typeof putPctNear === "number" && Number.isFinite(putPctNear) && putPctNear < threshold;
  return callHit || putHit;
}
