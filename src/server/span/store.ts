import { gunzipSync, gzipSync } from "node:zlib";
import { getRedis, isRedisConfigured } from "../redis";
import { logWarn } from "../logging";
import { normalizeSpanSymbol } from "./parse";
import type { SpanSnapshotMeta, SpanUnderlying } from "./types";
import { EXPOSURE_SOURCE } from "./exposure";

const MANIFEST_KEY = "near-expiry:span:manifest";
const BLOB_KEY = "near-expiry:span:blob";
const TTL_SECONDS = 60 * 60 * 48;
const CHUNK_BYTES = 700_000;

type MemoryStore = {
  manifest: SpanSnapshotMeta | null;
  underlyings: Map<string, SpanUnderlying>;
};

const globalStore = globalThis as typeof globalThis & {
  __nearExpirySpanStore?: MemoryStore;
};

function memory(): MemoryStore {
  if (!globalStore.__nearExpirySpanStore) {
    globalStore.__nearExpirySpanStore = {
      manifest: null,
      underlyings: new Map(),
    };
  }
  return globalStore.__nearExpirySpanStore;
}

export function resetSpanStoreForTests(): void {
  const store = memory();
  store.manifest = null;
  store.underlyings.clear();
}

function canonicalizeUnderlyings(
  underlyings: Map<string, SpanUnderlying> | Record<string, SpanUnderlying>,
): Map<string, SpanUnderlying> {
  const entries =
    underlyings instanceof Map
      ? underlyings.entries()
      : Object.entries(underlyings);
  const next = new Map<string, SpanUnderlying>();
  for (const [rawKey, row] of entries) {
    const key = normalizeSpanSymbol(rawKey);
    next.set(key, { ...row, symbol: key });
  }
  return next;
}

function encodeUnderlyings(
  underlyings: Map<string, SpanUnderlying>,
): Buffer {
  const payload = Object.fromEntries(underlyings.entries());
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
}

function decodeUnderlyings(buffer: Buffer): Map<string, SpanUnderlying> {
  const json = gunzipSync(buffer).toString("utf8");
  const payload = JSON.parse(json) as Record<string, SpanUnderlying>;
  return canonicalizeUnderlyings(payload);
}

function chunkBuffer(buffer: Buffer): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
    chunks.push(buffer.subarray(offset, offset + CHUNK_BYTES).toString("base64"));
  }
  return chunks;
}

export async function readSpanManifest(): Promise<SpanSnapshotMeta | null> {
  const redis = getRedis();
  if (!redis) {
    return memory().manifest;
  }
  return (await redis.get<SpanSnapshotMeta>(MANIFEST_KEY)) ?? null;
}

export async function writeSpanSnapshot(
  meta: Omit<
    SpanSnapshotMeta,
    "exposureSource" | "fetchedAt" | "underlyingCount" | "underlyings"
  > & {
    created?: string;
  },
  underlyings: Map<string, SpanUnderlying>,
): Promise<SpanSnapshotMeta> {
  const canonical = canonicalizeUnderlyings(underlyings);
  const snapshot: SpanSnapshotMeta = {
    date: meta.date,
    variant: meta.variant,
    created: meta.created,
    fetchedAt: new Date().toISOString(),
    underlyingCount: canonical.size,
    underlyings: [...canonical.keys()].sort(),
    exposureSource: EXPOSURE_SOURCE,
  };

  const redis = getRedis();
  if (!redis) {
    if (!isRedisConfigured()) {
      logWarn("Span store using in-process memory (Redis not configured)");
    }
    const store = memory();
    store.manifest = snapshot;
    store.underlyings = canonical;
    return snapshot;
  }

  const encoded = encodeUnderlyings(canonical);
  const chunks = chunkBuffer(encoded);
  const pipeline = redis.pipeline();
  pipeline.set(BLOB_KEY, { chunkCount: chunks.length }, { ex: TTL_SECONDS });
  chunks.forEach((chunk, index) => {
    pipeline.set(`${BLOB_KEY}:${index}`, chunk, { ex: TTL_SECONDS });
  });
  pipeline.set(MANIFEST_KEY, snapshot, { ex: TTL_SECONDS });
  await pipeline.exec();

  const store = memory();
  store.manifest = snapshot;
  store.underlyings = canonical;
  return snapshot;
}

async function loadAllUnderlyings(
  meta: SpanSnapshotMeta,
): Promise<Map<string, SpanUnderlying>> {
  const local = memory();
  if (
    local.manifest?.date === meta.date &&
    local.manifest.variant === meta.variant &&
    local.underlyings.size > 0
  ) {
    const canonical = canonicalizeUnderlyings(local.underlyings);
    local.underlyings = canonical;
    return canonical;
  }

  const redis = getRedis();
  if (!redis) {
    const canonical = canonicalizeUnderlyings(local.underlyings);
    local.underlyings = canonical;
    return canonical;
  }

  const head = await redis.get<{ chunkCount: number }>(BLOB_KEY);
  if (!head?.chunkCount) {
    return new Map();
  }

  const keys = Array.from(
    { length: head.chunkCount },
    (_, index) => `${BLOB_KEY}:${index}`,
  );
  const chunks = await redis.mget<string[]>(...keys);
  if (chunks.some((chunk) => typeof chunk !== "string")) {
    return new Map();
  }
  const buffer = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk as string, "base64")),
  );
  const underlyings = decodeUnderlyings(buffer);
  local.manifest = meta;
  local.underlyings = underlyings;
  return underlyings;
}

export async function readSpanUnderlyings(
  symbols: string[],
): Promise<{ meta: SpanSnapshotMeta; underlyings: Map<string, SpanUnderlying> } | null> {
  const meta = await readSpanManifest();
  if (!meta) {
    return null;
  }

  const all = await loadAllUnderlyings(meta);
  const wanted = [...new Set(symbols.map((symbol) => normalizeSpanSymbol(symbol)))];
  const underlyings = new Map<string, SpanUnderlying>();
  for (const symbol of wanted) {
    const row = all.get(symbol);
    if (row) {
      underlyings.set(symbol, row);
    }
  }
  return { meta, underlyings };
}
