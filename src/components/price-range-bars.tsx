import type { OptionType, PriceBand, UnderlyingPriceRanges } from "@/domain/types";
import { formatRupees } from "@/lib/format";

type PriceRangeBarsProps = {
  ranges: UnderlyingPriceRanges | null | undefined;
  spot: number | null | undefined;
  strike?: number | null;
  compact?: boolean;
  showLevels?: boolean;
  error?: string | null;
};

export function optionSideBadgeClass(optionType: OptionType): string {
  return optionType === "CALL"
    ? "bg-sky-100 text-sky-800 ring-sky-200"
    : "bg-orange-100 text-orange-700 ring-orange-300";
}

export function optionSideTextClass(optionType: OptionType): string {
  return optionType === "CALL" ? "text-sky-700" : "text-orange-700";
}

function positionPct(
  value: number | null | undefined,
  band: PriceBand,
): number | null {
  if (
    band.high === null ||
    band.low === null ||
    !Number.isFinite(band.high) ||
    !Number.isFinite(band.low) ||
    band.high < band.low ||
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return null;
  }
  if (band.high === band.low) {
    return 50;
  }
  return Math.min(100, Math.max(0, ((value - band.low) / (band.high - band.low)) * 100));
}

function bandTooltip(
  label: string,
  band: PriceBand,
  spot: number | null | undefined,
  strike: number | null | undefined,
): string {
  if (band.high === null || band.low === null) {
    return `${label}: unavailable`;
  }
  const parts = [`${label}: ${formatRupees(band.low)} – ${formatRupees(band.high)}`];
  if (spot !== null && spot !== undefined && Number.isFinite(spot) && spot > 0) {
    parts.push(`Spot ${formatRupees(spot)}`);
  }
  if (strike !== null && strike !== undefined && Number.isFinite(strike) && strike > 0) {
    const outside =
      strike < band.low
        ? " (below range)"
        : strike > band.high
          ? " (above range)"
          : "";
    parts.push(`Strike ${formatRupees(strike)}${outside}`);
  }
  return parts.join(" · ");
}

function RangeBar({
  label,
  band,
  spot,
  strike,
  compact,
}: {
  label: string;
  band: PriceBand;
  spot: number | null | undefined;
  strike: number | null | undefined;
  compact?: boolean;
}) {
  const hasBand =
    band.high !== null &&
    band.low !== null &&
    Number.isFinite(band.high) &&
    Number.isFinite(band.low) &&
    band.high >= band.low;
  const spotPct = hasBand ? positionPct(spot, band) : null;
  const strikePct = hasBand ? positionPct(strike, band) : null;
  const markerSize = compact ? "h-2 w-2" : "h-2.5 w-2.5";

  return (
    <div
      className={compact ? "flex min-w-[4.5rem] flex-col gap-0.5" : "flex min-w-[5.5rem] flex-col gap-0.5"}
      title={bandTooltip(label, band, spot, strike)}
    >
      <span
        className={`font-medium tracking-wide text-zinc-500 uppercase ${
          compact ? "text-[10px]" : "text-xs"
        }`}
      >
        {label}
      </span>
      <div className="relative h-1.5 w-full rounded-full bg-zinc-200">
        {hasBand ? (
          <div className="absolute inset-0 rounded-full bg-zinc-300/80" />
        ) : null}
        {spotPct !== null ? (
          <span
            className={`absolute top-1/2 ${markerSize} -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-zinc-900 shadow-sm`}
            style={{ left: `${spotPct}%` }}
            aria-label="Spot"
          />
        ) : null}
        {strikePct !== null ? (
          <span
            className={`absolute top-1/2 ${markerSize} -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-red-600 shadow-sm`}
            style={{ left: `${strikePct}%` }}
            aria-label="Strike"
          />
        ) : null}
      </div>
      <span
        className={`tabular-nums text-zinc-600 ${compact ? "text-[10px]" : "text-xs"}`}
      >
        {hasBand
          ? `${formatRupees(band.low, compact ? 0 : 2)}–${formatRupees(band.high, compact ? 0 : 2)}`
          : "—"}
      </span>
    </div>
  );
}

export function PriceRangeBars({
  ranges,
  spot,
  strike,
  compact = false,
  showLevels = false,
  error,
}: PriceRangeBarsProps) {
  if (!ranges && !error) {
    return null;
  }

  return (
    <div
      className={`flex flex-col ${compact ? "gap-1" : "gap-1.5"}`}
      aria-label="Price ranges"
    >
      {showLevels ? (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums text-zinc-900 ${
            compact ? "text-sm font-medium" : "text-base font-medium"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-900" aria-hidden="true" />
            Spot {formatRupees(spot)}
          </span>
          {strike !== null && strike !== undefined ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" />
              Strike {formatRupees(strike)}
            </span>
          ) : null}
        </div>
      ) : null}
      {ranges ? (
        <div
          className={`flex flex-wrap items-end ${compact ? "gap-x-3 gap-y-1" : "gap-x-5 gap-y-2"}`}
        >
          <RangeBar
            label="1M"
            band={ranges.oneMonth}
            spot={spot}
            strike={strike}
            compact={compact}
          />
          <RangeBar
            label="3M"
            band={ranges.threeMonth}
            spot={spot}
            strike={strike}
            compact={compact}
          />
          <RangeBar
            label="1Y"
            band={ranges.oneYear}
            spot={spot}
            strike={strike}
            compact={compact}
          />
        </div>
      ) : null}
      {error ? (
        <div
          className={`text-amber-800 ${compact ? "text-[10px] max-w-[14rem]" : "text-xs max-w-sm"}`}
          role="alert"
          title={error}
        >
          Ranges unavailable: {error}
        </div>
      ) : null}
    </div>
  );
}
