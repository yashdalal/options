import type { RawPosition } from "@/server/kotak/positions";
import type {
  ScripInstrument,
  ScripMasterRegistry,
} from "@/server/kotak/scrip-master";
import type { NormalizedPosition, OptionType } from "./types";

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

function parseOptionType(value: string | undefined): OptionType | null {
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

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export function formatExpiryLabel(expiryIso: string): string {
  const [year, month, day] = expiryIso.split("-").map(Number);
  if (!year || !month || !day) {
    return expiryIso;
  }
  return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}`;
}

export function parseExpiryValue(value: string | undefined): string | null {
  if (!value || value === "-" || value === "NA") {
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const dmy = value.match(/^(\d{1,2})[- ]([A-Za-z]{3}),?[- ]+(\d{2,4})$/);
  if (dmy) {
    const monthMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const month = monthMap[dmy[2].toLowerCase()];
    if (!month) {
      return null;
    }
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${month}-${dmy[1].padStart(2, "0")}`;
  }

  return null;
}

export function computeNetQuantity(raw: RawPosition): number {
  const lotSize = Math.max(toNumber(raw.lotSz), 1);
  const hasCarryOrFill =
    raw.cfBuyQty !== undefined ||
    raw.flBuyQty !== undefined ||
    raw.cfSellQty !== undefined ||
    raw.flSellQty !== undefined;

  if (hasCarryOrFill) {
    const totalBuy = toNumber(raw.cfBuyQty) + toNumber(raw.flBuyQty);
    const totalSell = toNumber(raw.cfSellQty) + toNumber(raw.flSellQty);
    return (totalBuy - totalSell) / lotSize;
  }

  return toNumber(raw.qty) / lotSize;
}

function companyFromSymbol(tradingSymbol: string, fallback?: string): string {
  if (fallback && fallback.trim()) {
    return fallback.trim().toUpperCase();
  }
  const cleaned = tradingSymbol.trim().toUpperCase();
  const match = cleaned.match(/^([A-Z0-9&-]+)/);
  return match?.[1] ?? cleaned;
}

export function normalizePositions(
  rawPositions: RawPosition[],
  registry?: ScripMasterRegistry,
): NormalizedPosition[] {
  const normalized: NormalizedPosition[] = [];

  rawPositions.forEach((raw, index) => {
    const exchangeSegment = String(raw.exSeg ?? "").toLowerCase();
    if (exchangeSegment !== "nse_fo") {
      return;
    }

    const instrumentToken = String(raw.tok ?? "").trim();
    const tradingSymbol = String(raw.trdSym ?? raw.sym ?? "").trim();
    const resolved: ScripInstrument | null =
      registry && instrumentToken
        ? registry.byToken.get(`${exchangeSegment}:${instrumentToken}`) ?? null
        : null;

    const optionType =
      parseOptionType(raw.optTp) ??
      resolved?.optionType ??
      parseOptionType(String(raw.it ?? ""));

    const strike =
      toNumber(raw.stkPrc) ||
      resolved?.strike ||
      0;

    const expiryIso =
      parseExpiryValue(raw.expDt) ??
      parseExpiryValue(raw.exp) ??
      resolved?.expiryIso ??
      null;

    if (!optionType || !strike || !expiryIso) {
      return;
    }

    const netQuantity = computeNetQuantity(raw);
    if (netQuantity === 0) {
      return;
    }

    const company = companyFromSymbol(
      tradingSymbol || resolved?.tradingSymbol || "",
      resolved?.underlying ?? raw.sym,
    );

    normalized.push({
      id: `${exchangeSegment}:${instrumentToken || tradingSymbol}:${index}`,
      company,
      exchangeSegment,
      instrumentToken: instrumentToken || resolved?.instrumentToken || tradingSymbol,
      tradingSymbol: tradingSymbol || resolved?.tradingSymbol || company,
      optionType,
      strike,
      expiryIso,
      expiryLabel: formatExpiryLabel(expiryIso),
      netQuantity,
      lotSize: Math.max(toNumber(raw.lotSz) || resolved?.lotSize || 1, 1),
    });
  });

  return normalized;
}
