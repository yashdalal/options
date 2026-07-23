import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { filterExpiriesWithinMonthsAhead } from "@/lib/expiry-horizon";
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

const SCRIP_REGISTRY_BUILD = 4;

const SCRIP_SEGMENTS = ["nse_fo", "nse_cm", "bse_fo", "bse_cm"] as const;
type ScripSegment = (typeof SCRIP_SEGMENTS)[number];

const CASH_SEGMENTS = new Set<string>(["nse_cm", "bse_cm"]);
const OPTION_SEGMENTS = new Set<string>(["nse_fo", "bse_fo"]);

const globalStore = globalThis as typeof globalThis & {
  __scripMasterRegistryCache?: {
    asOfDate: string;
    build: number;
    registry: ScripMasterRegistry;
  };
};

if (globalStore.__scripMasterRegistryCache?.build !== SCRIP_REGISTRY_BUILD) {
  delete globalStore.__scripMasterRegistryCache;
}

function todayIstDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function clearScripMasterRegistryMemoryCache(): void {
  delete globalStore.__scripMasterRegistryCache;
}

export function seedScripMasterRegistryMemoryCache(
  registry: ScripMasterRegistry,
): void {
  globalStore.__scripMasterRegistryCache = {
    asOfDate: registry.asOfDate,
    build: SCRIP_REGISTRY_BUILD,
    registry,
  };
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

const KOTAK_EPOCH_MS = Date.UTC(1980, 0, 1);

function formatUtcDate(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseExpiry(
  value: string | undefined,
  exchangeSegment?: string,
): string | null {
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

  // NSE masters use seconds since 1980-01-01; BSE masters use Unix epoch seconds.
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      const ms = exchangeSegment?.startsWith("bse_")
        ? seconds * 1000
        : KOTAK_EPOCH_MS + seconds * 1000;
      return formatUtcDate(ms);
    }
  }

  return null;
}

function parseStrike(value: string | undefined): number | null {
  const parsed = toNumber(value);
  if (parsed === null) {
    return null;
  }
  // Kotak Neo dStrikePrice is strike * 100 (paise).
  return parsed / 100;
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
    "pinsttype",
    "pinstname",
    "instrumenttype",
    "instrument_type",
  ]);
  const optionIdx = index(["poptiontype", "optiontype", "option_type", "opttype"]);
  const strikeIdx = index(["dstrikeprice", "dstrikeprice;", "strikeprice", "strike"]);
  const expiryIdx = index([
    "dexpirydate",
    "lexpirydate",
    "pexpirydate",
    "expirydate",
    "expiry",
  ]);
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
      strike: parseStrike(strikeIdx >= 0 ? cells[strikeIdx] : undefined),
      expiryIso: parseExpiry(
        expiryIdx >= 0 ? cells[expiryIdx] : undefined,
        exchangeSegment,
      ),
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

function isScreenableOption(instrument: ScripInstrument): boolean {
  if (!OPTION_SEGMENTS.has(instrument.exchangeSegment) || !instrument.optionType) {
    return false;
  }
  if (instrument.strike === null || !instrument.expiryIso) {
    return false;
  }
  const type = instrument.instrumentType.toUpperCase();
  return (
    type.includes("OPTSTK") ||
    type.includes("OPTIDX") ||
    type === "IO" ||
    type === "SO" ||
    type === "CE" ||
    type === "PE" ||
    type === ""
  );
}

function buildRegistry(asOfDate: string, instruments: ScripInstrument[]): ScripMasterRegistry {
  const byToken = new Map<string, ScripInstrument>();
  const cashBySymbol = new Map<string, ScripInstrument>();
  const optionsByUnderlying = new Map<string, ScripInstrument[]>();

  for (const instrument of instruments) {
    byToken.set(`${instrument.exchangeSegment}:${instrument.instrumentToken}`, instrument);
    if (CASH_SEGMENTS.has(instrument.exchangeSegment)) {
      setPreferredCashSymbol(cashBySymbol, instrument.underlying.toUpperCase(), instrument);
      const withoutSuffix = instrument.tradingSymbol.replace(/-EQ$/i, "").toUpperCase();
      setPreferredCashSymbol(cashBySymbol, withoutSuffix, instrument);
    }
    if (isScreenableOption(instrument)) {
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

function registryIncludesSegments(
  registry: ScripMasterRegistry,
  segments: readonly string[],
): boolean {
  const present = new Set<string>();
  for (const key of registry.byToken.keys()) {
    const segment = key.split(":")[0];
    if (segment) {
      present.add(segment);
    }
  }
  return segments.every((segment) => present.has(segment));
}

export async function loadScripMasterRegistry(
  session: TradeSessionCredentials,
): Promise<ScripMasterRegistry> {
  const asOfDate = todayIstDate();
  const memory = globalStore.__scripMasterRegistryCache;
  if (
    memory?.asOfDate === asOfDate &&
    memory.build === SCRIP_REGISTRY_BUILD &&
    registryIncludesSegments(memory.registry, SCRIP_SEGMENTS)
  ) {
    return memory.registry;
  }
  delete globalStore.__scripMasterRegistryCache;

  await mkdir(CACHE_DIR, { recursive: true });

  const metaPath = path.join(CACHE_DIR, "meta.json");
  const segmentPaths = Object.fromEntries(
    SCRIP_SEGMENTS.map((segment) => [segment, path.join(CACHE_DIR, `${segment}.csv`)]),
  ) as Record<ScripSegment, string>;

  let useCache = false;
  if (
    (await fileExists(metaPath)) &&
    (await Promise.all(SCRIP_SEGMENTS.map((segment) => fileExists(segmentPaths[segment])))).every(
      Boolean,
    )
  ) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
        asOfDate?: string;
        segments?: string[];
      };
      useCache =
        meta.asOfDate === asOfDate &&
        Array.isArray(meta.segments) &&
        SCRIP_SEGMENTS.every((segment) => meta.segments?.includes(segment));
    } catch {
      useCache = false;
    }
  }

  if (!useCache) {
    logInfo("Downloading scrip master files", { segments: [...SCRIP_SEGMENTS] });
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

    const filePaths = parsed.data.data.filesPaths;
    const segmentUrls = SCRIP_SEGMENTS.map((segment) => {
      const url = filePaths.find((candidate) =>
        candidate.toLowerCase().includes(segment.toLowerCase()),
      );
      if (!url) {
        logWarn("Scrip master file path missing for segment", {
          segment,
          available: filePaths,
        });
        throw new KotakApiError(
          `Missing ${segment} scrip master file`,
          500,
          "invalid_response",
        );
      }
      return { segment, url };
    });

    const downloads = await Promise.all(
      segmentUrls.map(async ({ segment, url }) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new KotakApiError(
            `Failed to download ${segment} scrip master`,
            response.status,
          );
        }
        const csv = await response.text();
        return { segment, csv };
      }),
    );

    await Promise.all(
      downloads.map(({ segment, csv }) => writeFile(segmentPaths[segment], csv, "utf8")),
    );
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          asOfDate,
          build: SCRIP_REGISTRY_BUILD,
          segments: [...SCRIP_SEGMENTS],
        },
        null,
        2,
      ),
      "utf8",
    );
  } else {
    logInfo("Using cached scrip master", { asOfDate, build: SCRIP_REGISTRY_BUILD });
  }

  const instruments = (
    await Promise.all(
      SCRIP_SEGMENTS.map(async (segment) =>
        parseScripCsv(await readFile(segmentPaths[segment], "utf8"), segment),
      ),
    )
  ).flat();

  if (instruments.length === 0) {
    logWarn("Scrip master parsed zero instruments");
  }

  const registry = buildRegistry(asOfDate, instruments);
  globalStore.__scripMasterRegistryCache = {
    asOfDate,
    build: SCRIP_REGISTRY_BUILD,
    registry,
  };
  return registry;
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

/** Sensex weeklies go far out; report/screener only need this month and next (IST). */
export function filterExpiriesToCurrentAndNextMonth(
  expiries: string[],
  now: Date = new Date(),
): string[] {
  return filterExpiriesWithinMonthsAhead(expiries, 1, now);
}

export function listExpiriesForUnderlying(
  registry: ScripMasterRegistry,
  underlying: string,
  now: Date = new Date(),
): string[] {
  const options = registry.optionsByUnderlying.get(underlying.toUpperCase()) ?? [];
  const expiries = new Set<string>();
  for (const option of options) {
    if (option.expiryIso) {
      expiries.add(option.expiryIso);
    }
  }
  const sorted = [...expiries].sort();
  if (underlying.toUpperCase() === "SENSEX") {
    return filterExpiriesToCurrentAndNextMonth(sorted, now);
  }
  return sorted;
}

export function listOptionsForUnderlyingExpiry(
  registry: ScripMasterRegistry,
  underlying: string,
  expiryIso: string,
): ScripInstrument[] {
  const options = registry.optionsByUnderlying.get(underlying.toUpperCase()) ?? [];
  return options.filter((option) => option.expiryIso === expiryIso);
}
