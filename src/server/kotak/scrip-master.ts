import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { kotakFetch } from "./client";
import { KotakApiError } from "./errors";
import type { TradeSessionCredentials } from "./auth";
import { logInfo, logWarn } from "../logging";

const scripMasterResponseSchema = z.object({
  data: z.object({
    filesPaths: z.array(z.string().url()).default([]),
    baseFolder: z.string().optional(),
  }),
});

export type ScripInstrument = {
  exchangeSegment: string;
  instrumentToken: string;
  tradingSymbol: string;
  underlying: string;
  instrumentType: string;
  optionType: "CALL" | "PUT" | null;
  strike: number | null;
  expiryIso: string | null;
  lotSize: number;
  multiplier: number;
};

export type ScripMasterRegistry = {
  asOfDate: string;
  byToken: Map<string, ScripInstrument>;
  cashBySymbol: Map<string, ScripInstrument>;
  optionUnderlyings: string[];
  optionsByUnderlying: Map<string, ScripInstrument[]>;
};

const CACHE_DIR =
  process.env.VERCEL === "1"
    ? path.join(os.tmpdir(), "near-expiry", "scrip-master")
    : path.join(process.cwd(), ".cache", "scrip-master");

function todayIstDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.replace(/;/g, "").trim().toLowerCase();
}

function parseExpiry(value: string | undefined): string | null {
  if (!value || value === "-" || value === "NA") {
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const dmy = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmy) {
    const months: Record<string, string> = {
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
    const month = months[dmy[2].toLowerCase()];
    if (month) {
      return `${dmy[3]}-${month}-${dmy[1]}`;
    }
  }

  const compact = value.match(/^(\d{2})([A-Za-z]{3})(\d{4})$/);
  if (compact) {
    const months: Record<string, string> = {
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
    const month = months[compact[2].toLowerCase()];
    if (month) {
      return `${compact[3]}-${month}-${compact[1]}`;
    }
  }

  return null;
}

function parseOptionType(value: string | undefined): "CALL" | "PUT" | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "CE" || normalized === "CALL" || normalized === "C") {
    return "CALL";
  }
  if (normalized === "PE" || normalized === "PUT" || normalized === "P") {
    return "PUT";
  }
  return null;
}

function toNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/;/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseScripCsv(
  csv: string,
  exchangeSegment: string,
): ScripInstrument[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const index = (names: string[]): number =>
    headers.findIndex((header) => names.includes(header));

  const tokenIdx = index(["psymbol", "token", "instrument_token", "instrumenttoken"]);
  const symbolIdx = index([
    "ptrdsymbol",
    "ptradingsymbol",
    "tradingsymbol",
    "trdsymbol",
    "trading_symbol",
    "symbol",
  ]);
  const underlyingIdx = index([
    "psymbl",
    "psymbolname",
    "undersymbol",
    "underlying",
    "name",
  ]);
  const typeIdx = index([
    "pinstrumenttype",
    "instrumenttype",
    "instrument_type",
  ]);
  const optionIdx = index(["poptiontype", "optiontype", "option_type", "opttype"]);
  const strikeIdx = index(["dstrikeprice", "dstrikeprice;", "strikeprice", "strike"]);
  const expiryIdx = index(["dexpirydate", "expirydate", "expiry"]);
  const lotIdx = index(["llotsize", "lotsize", "lot_size"]);
  const multiplierIdx = index(["lmultiplier", "multiplier"]);

  const instruments: ScripInstrument[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const token = tokenIdx >= 0 ? cells[tokenIdx] : "";
    const tradingSymbol = symbolIdx >= 0 ? cells[symbolIdx] : "";
    if (!token || !tradingSymbol) {
      continue;
    }

    const instrumentType = (typeIdx >= 0 ? cells[typeIdx] : "").toUpperCase();
    const optionType =
      parseOptionType(optionIdx >= 0 ? cells[optionIdx] : undefined) ??
      parseOptionType(instrumentType);

    instruments.push({
      exchangeSegment,
      instrumentToken: token,
      tradingSymbol,
      underlying: (underlyingIdx >= 0 ? cells[underlyingIdx] : tradingSymbol.split("-")[0]) || tradingSymbol,
      instrumentType,
      optionType,
      strike: toNumber(strikeIdx >= 0 ? cells[strikeIdx] : undefined),
      expiryIso: parseExpiry(expiryIdx >= 0 ? cells[expiryIdx] : undefined),
      lotSize: toNumber(lotIdx >= 0 ? cells[lotIdx] : undefined) ?? 1,
      multiplier: toNumber(multiplierIdx >= 0 ? cells[multiplierIdx] : undefined) ?? 1,
    });
  }

  return instruments;
}

function cashInstrumentPreference(instrument: ScripInstrument): number {
  if (instrument.tradingSymbol.endsWith("-EQ")) {
    return 2;
  }
  if (!instrument.tradingSymbol.includes("-")) {
    return 2;
  }
  return 1;
}

function preferCashInstrument(
  existing: ScripInstrument | undefined,
  candidate: ScripInstrument,
): ScripInstrument {
  if (!existing) {
    return candidate;
  }
  return cashInstrumentPreference(candidate) > cashInstrumentPreference(existing)
    ? candidate
    : existing;
}

function setPreferredCashSymbol(
  cashBySymbol: Map<string, ScripInstrument>,
  key: string,
  instrument: ScripInstrument,
): void {
  cashBySymbol.set(key, preferCashInstrument(cashBySymbol.get(key), instrument));
}

function isStockOption(instrument: ScripInstrument): boolean {
  if (instrument.exchangeSegment !== "nse_fo" || !instrument.optionType) {
    return false;
  }
  if (instrument.strike === null || !instrument.expiryIso) {
    return false;
  }
  const type = instrument.instrumentType.toUpperCase();
  return type.includes("OPTSTK") || type === "CE" || type === "PE" || type === "";
}

function buildRegistry(asOfDate: string, instruments: ScripInstrument[]): ScripMasterRegistry {
  const byToken = new Map<string, ScripInstrument>();
  const cashBySymbol = new Map<string, ScripInstrument>();
  const optionsByUnderlying = new Map<string, ScripInstrument[]>();

  for (const instrument of instruments) {
    byToken.set(`${instrument.exchangeSegment}:${instrument.instrumentToken}`, instrument);
    if (instrument.exchangeSegment === "nse_cm") {
      setPreferredCashSymbol(cashBySymbol, instrument.underlying.toUpperCase(), instrument);
      const withoutSuffix = instrument.tradingSymbol.replace(/-EQ$/i, "").toUpperCase();
      setPreferredCashSymbol(cashBySymbol, withoutSuffix, instrument);
    }
    if (isStockOption(instrument)) {
      const key = instrument.underlying.toUpperCase();
      const existing = optionsByUnderlying.get(key);
      if (existing) {
        existing.push(instrument);
      } else {
        optionsByUnderlying.set(key, [instrument]);
      }
    }
  }

  const optionUnderlyings = [...optionsByUnderlying.keys()]
    .filter((symbol) => cashBySymbol.has(symbol))
    .sort((left, right) => left.localeCompare(right));

  return { asOfDate, byToken, cashBySymbol, optionUnderlyings, optionsByUnderlying };
}

export function buildScripMasterRegistryFromInstruments(
  asOfDate: string,
  instruments: ScripInstrument[],
): ScripMasterRegistry {
  return buildRegistry(asOfDate, instruments);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadScripMasterRegistry(
  session: TradeSessionCredentials,
): Promise<ScripMasterRegistry> {
  const asOfDate = todayIstDate();
  await mkdir(CACHE_DIR, { recursive: true });

  const metaPath = path.join(CACHE_DIR, "meta.json");
  const foPath = path.join(CACHE_DIR, "nse_fo.csv");
  const cmPath = path.join(CACHE_DIR, "nse_cm.csv");

  let useCache = false;
  if ((await fileExists(metaPath)) && (await fileExists(foPath)) && (await fileExists(cmPath))) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as { asOfDate?: string };
      useCache = meta.asOfDate === asOfDate;
    } catch {
      useCache = false;
    }
  }

  if (!useCache) {
    logInfo("Downloading scrip master files");
    const payload = await kotakFetch(
      `${session.baseUrl}/script-details/1.0/masterscrip/file-paths`,
      {
        method: "GET",
        headers: {
          Authorization: session.accessToken,
          "neo-fin-key": session.neoFinKey,
        },
      },
    );

    const parsed = scripMasterResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new KotakApiError("Unexpected scrip master response", 500, "invalid_response");
    }

    const foUrl = parsed.data.data.filesPaths.find((url) => url.includes("nse_fo"));
    const cmUrl = parsed.data.data.filesPaths.find((url) => url.includes("nse_cm"));
    if (!foUrl || !cmUrl) {
      throw new KotakApiError("Missing nse_fo/nse_cm scrip master files", 500, "invalid_response");
    }

    const [foCsv, cmCsv] = await Promise.all([
      fetch(foUrl).then((response) => {
        if (!response.ok) {
          throw new KotakApiError("Failed to download nse_fo scrip master", response.status);
        }
        return response.text();
      }),
      fetch(cmUrl).then((response) => {
        if (!response.ok) {
          throw new KotakApiError("Failed to download nse_cm scrip master", response.status);
        }
        return response.text();
      }),
    ]);

    await writeFile(foPath, foCsv, "utf8");
    await writeFile(cmPath, cmCsv, "utf8");
    await writeFile(metaPath, JSON.stringify({ asOfDate }, null, 2), "utf8");
  } else {
    logInfo("Using cached scrip master", { asOfDate });
  }

  const foCsv = await readFile(foPath, "utf8");
  const cmCsv = await readFile(cmPath, "utf8");
  const instruments = [
    ...parseScripCsv(foCsv, "nse_fo"),
    ...parseScripCsv(cmCsv, "nse_cm"),
  ];

  if (instruments.length === 0) {
    logWarn("Scrip master parsed zero instruments");
  }

  return buildRegistry(asOfDate, instruments);
}

export function resolveCashInstrument(
  registry: ScripMasterRegistry,
  underlying: string,
): ScripInstrument | null {
  return registry.cashBySymbol.get(underlying.toUpperCase()) ?? null;
}

export function listOptionUnderlyings(registry: ScripMasterRegistry): string[] {
  return registry.optionUnderlyings;
}

export function listExpiriesForUnderlying(
  registry: ScripMasterRegistry,
  underlying: string,
): string[] {
  const options = registry.optionsByUnderlying.get(underlying.toUpperCase()) ?? [];
  const expiries = new Set<string>();
  for (const option of options) {
    if (option.expiryIso) {
      expiries.add(option.expiryIso);
    }
  }
  return [...expiries].sort();
}

export function listOptionsForUnderlyingExpiry(
  registry: ScripMasterRegistry,
  underlying: string,
  expiryIso: string,
): ScripInstrument[] {
  const options = registry.optionsByUnderlying.get(underlying.toUpperCase()) ?? [];
  return options.filter((option) => option.expiryIso === expiryIso);
}
