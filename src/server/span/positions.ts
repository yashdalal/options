import type { AccountId } from "@/config/accounts";
import {
  computeNetQuantity,
  parseExpiryValue,
} from "@/domain/positions";
import type { TradeSessionCredentials } from "../kotak/auth";
import { fetchPositions, type RawPosition } from "../kotak/positions";
import {
  loadScripMasterRegistry,
  type ScripInstrument,
} from "../kotak/scrip-master";
import { SpanError } from "./errors";
import { isIndexUnderlying } from "./exposure";
import type { SpanPosition } from "./types";

const SPAN_FO_SEGMENTS = new Set(["nse_fo", "bse_fo"]);

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseOptionType(value: string | undefined): "CALL" | "PUT" | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized === "CE" || normalized === "CALL" || normalized === "C") {
    return "CALL";
  }
  if (normalized === "PE" || normalized === "PUT" || normalized === "P") {
    return "PUT";
  }
  return null;
}

function companyFromSymbol(tradingSymbol: string, fallback?: string): string {
  if (fallback && fallback.trim()) {
    return fallback.trim().toUpperCase();
  }
  const cleaned = tradingSymbol.trim().toUpperCase();
  const match = cleaned.match(/^([A-Z0-9&-]+)/);
  return match?.[1] ?? cleaned;
}

function isFuturesRow(raw: RawPosition, resolved: ScripInstrument | null): boolean {
  const instrumentType = String(raw.it ?? resolved?.instrumentType ?? "")
    .trim()
    .toUpperCase();
  if (instrumentType.includes("FUT")) {
    return true;
  }
  const optionType = parseOptionType(raw.optTp) ?? resolved?.optionType ?? null;
  const strike = toNumber(raw.stkPrc) || resolved?.strike || 0;
  return !optionType && !strike && Boolean(parseExpiryValue(raw.expDt) ?? parseExpiryValue(raw.exp) ?? resolved?.expiryIso);
}

export function mapRawPositionsToSpan(
  rawPositions: RawPosition[],
  registry: Awaited<ReturnType<typeof loadScripMasterRegistry>> | undefined,
): SpanPosition[] {
  const positions: SpanPosition[] = [];

  for (const raw of rawPositions) {
    const exchangeSegment = String(raw.exSeg ?? "").toLowerCase();
    if (!SPAN_FO_SEGMENTS.has(exchangeSegment)) {
      continue;
    }

    const instrumentToken = String(raw.tok ?? "").trim();
    const tradingSymbol = String(raw.trdSym ?? raw.sym ?? "").trim();
    const resolved =
      registry && instrumentToken
        ? registry.byToken.get(`${exchangeSegment}:${instrumentToken}`) ?? null
        : null;

    const lotSize = Math.max(toNumber(raw.lotSz) || resolved?.lotSize || 1, 1);
    const netLots = computeNetQuantity(raw);
    if (netLots === 0) {
      continue;
    }
    const quantity = netLots * lotSize;
    const underlying = companyFromSymbol(
      tradingSymbol || resolved?.tradingSymbol || "",
      resolved?.underlying ?? raw.sym,
    );
    const expiryIso =
      parseExpiryValue(raw.expDt) ??
      parseExpiryValue(raw.exp) ??
      resolved?.expiryIso ??
      null;
    if (!expiryIso) {
      throw new SpanError(
        `Unable to map Kotak position expiry for ${tradingSymbol || instrumentToken}`,
        422,
        "span_position_unmapped",
      );
    }

    if (isFuturesRow(raw, resolved)) {
      positions.push({
        underlying,
        instrumentType: "FUT",
        expiryIso,
        quantity,
      });
      continue;
    }

    const optionType =
      parseOptionType(raw.optTp) ??
      resolved?.optionType ??
      parseOptionType(String(raw.it ?? ""));
    const strike = toNumber(raw.stkPrc) || resolved?.strike || 0;
    if (!optionType || !strike) {
      throw new SpanError(
        `Unable to map Kotak option position ${tradingSymbol || instrumentToken}`,
        422,
        "span_position_unmapped",
      );
    }

    positions.push({
      underlying,
      instrumentType: "OPT",
      optionType,
      expiryIso,
      strike,
      quantity,
    });
  }

  return positions;
}

export async function loadAccountSpanPositions(
  session: TradeSessionCredentials,
  accountId: AccountId,
  requestId: string,
): Promise<SpanPosition[]> {
  const registry = await loadScripMasterRegistry(session);
  const raw = await fetchPositions(session, requestId, accountId);
  return mapRawPositionsToSpan(raw, registry);
}

export type BasketLegInput = {
  exchangeSegment: string;
  underlying: string;
  expiryIso: string;
  strike: number;
  optionType: "CALL" | "PUT";
  side: "BUY" | "SELL";
  lots: number;
  lotSize: number;
};

export function basketLegsToSpanPositions(legs: BasketLegInput[]): SpanPosition[] {
  return legs.map((leg) => {
    if (!SPAN_FO_SEGMENTS.has(leg.exchangeSegment.toLowerCase())) {
      throw new SpanError(
        `Unsupported F&O segment: ${leg.exchangeSegment}`,
        422,
        "span_segment_unsupported",
      );
    }
    if (!(leg.lots > 0) || !(leg.lotSize > 0)) {
      throw new SpanError("Basket legs require positive lots and lotSize", 400, "invalid_leg");
    }
    const signedLots = leg.side === "SELL" ? -leg.lots : leg.lots;
    return {
      underlying: leg.underlying.toUpperCase(),
      instrumentType: "OPT" as const,
      optionType: leg.optionType,
      expiryIso: leg.expiryIso,
      strike: leg.strike,
      quantity: signedLots * leg.lotSize,
    };
  });
}

export function deliveryMarginWarningFor(
  positions: SpanPosition[],
  asOf = new Date(),
): string | null {
  const stockNearExpiry = positions.filter((position) => {
    if (isIndexUnderlying(position.underlying)) {
      return false;
    }
    const [year, month, day] = position.expiryIso.split("-").map(Number);
    if (!year || !month || !day) {
      return false;
    }
    const expiry = new Date(Date.UTC(year, month - 1, day));
    const today = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
    );
    const days =
      (expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
    return days >= 0 && days <= 5;
  });

  if (stockNearExpiry.length === 0) {
    return null;
  }

  const expiryLabels = [
    ...new Set(stockNearExpiry.map((row) => row.expiryIso)),
  ]
    .sort()
    .map((expiryIso) => {
      const [year, month, day] = expiryIso.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
        "en-GB",
        {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        },
      );
    });

  const expiryText =
    expiryLabels.length === 1
      ? expiryLabels[0]
      : `${expiryLabels.slice(0, -1).join(", ")} and ${expiryLabels.at(-1)}`;

  return `Stock derivatives expiring ${expiryText} may attract exchange delivery margins not included in SPAN+ELM.`;
}
