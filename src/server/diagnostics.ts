import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRedis } from "./redis";
import { logError, logWarn, redactString, redactValue, safeErrorMessage } from "./logging";

export const DIAGNOSTICS_KEY = "options:diagnostics:failures";
export const DIAGNOSTICS_MAX_ENTRIES = 500;
export const DIAGNOSTICS_TTL_SECONDS = 60 * 60 * 24 * 7;

export type DiagnosticKind =
  | "screen_snapshot"
  | "screen_margin"
  | "quote_batch"
  | "quote_empty_batch"
  | "monitor"
  | "limits"
  | "auth";

export type DiagnosticEventInput = {
  kind: DiagnosticKind;
  requestId?: string;
  symbol?: string;
  accountId?: string;
  message: string;
  detail?: unknown;
};

export type DiagnosticEvent = DiagnosticEventInput & {
  at: string;
};

function localDiagnosticsFile(): string {
  return (
    process.env.DIAGNOSTICS_FILE ??
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".cache", "diagnostics.jsonl")
  );
}

const MEMORY_KEY = "__optionsDiagnosticsMemory";

function memoryEntries(): DiagnosticEvent[] {
  const globalStore = globalThis as typeof globalThis & {
    [MEMORY_KEY]?: DiagnosticEvent[];
  };
  globalStore[MEMORY_KEY] ??= [];
  return globalStore[MEMORY_KEY];
}

function toEvent(input: DiagnosticEventInput): DiagnosticEvent {
  return {
    at: new Date().toISOString(),
    kind: input.kind,
    requestId: input.requestId,
    symbol: input.symbol,
    accountId: input.accountId,
    message: redactString(input.message),
    detail: input.detail === undefined ? undefined : redactValue(input.detail),
  };
}

function parseEvent(item: unknown): DiagnosticEvent | null {
  if (typeof item === "string") {
    try {
      return JSON.parse(item) as DiagnosticEvent;
    } catch {
      return null;
    }
  }
  if (item && typeof item === "object") {
    return item as DiagnosticEvent;
  }
  return null;
}

async function readLocalFileEvents(): Promise<DiagnosticEvent[]> {
  try {
    const content = await readFile(localDiagnosticsFile(), "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map(parseEvent)
      .filter((event): event is DiagnosticEvent => event !== null)
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function appendLocalFileEvent(event: DiagnosticEvent): Promise<void> {
  const file = localDiagnosticsFile();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  const newestFirst = await readLocalFileEvents();
  if (newestFirst.length > DIAGNOSTICS_MAX_ENTRIES) {
    const kept = newestFirst.slice(0, DIAGNOSTICS_MAX_ENTRIES).reverse();
    await writeFile(file, kept.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  }
}

function pushMemoryEvent(event: DiagnosticEvent): void {
  const entries = memoryEntries();
  entries.unshift(event);
  entries.length = Math.min(entries.length, DIAGNOSTICS_MAX_ENTRIES);
}

export function resetDiagnosticsForTests(): void {
  memoryEntries().length = 0;
}

export async function recordDiagnosticEvent(input: DiagnosticEventInput): Promise<void> {
  const event = toEvent(input);
  try {
    const redis = getRedis();
    if (redis) {
      await redis.lpush(DIAGNOSTICS_KEY, JSON.stringify(event));
      await redis.ltrim(DIAGNOSTICS_KEY, 0, DIAGNOSTICS_MAX_ENTRIES - 1);
      await redis.expire(DIAGNOSTICS_KEY, DIAGNOSTICS_TTL_SECONDS);
      return;
    }
    if (process.env.VERCEL) {
      logError("Diagnostic event (Redis not configured, kept in instance memory only)", event);
      pushMemoryEvent(event);
      return;
    }
    await appendLocalFileEvent(event);
  } catch (error) {
    logWarn("Failed to record diagnostic event", {
      kind: input.kind,
      message: safeErrorMessage(error),
    });
    pushMemoryEvent(event);
  }
}

export async function listDiagnosticEvents(
  limit = DIAGNOSTICS_MAX_ENTRIES,
): Promise<DiagnosticEvent[]> {
  const capped = Math.max(1, Math.min(DIAGNOSTICS_MAX_ENTRIES, Math.floor(limit)));
  const redis = getRedis();
  if (redis) {
    const raw = await redis.lrange<unknown>(DIAGNOSTICS_KEY, 0, capped - 1);
    return raw.map(parseEvent).filter((event): event is DiagnosticEvent => event !== null);
  }
  if (process.env.VERCEL) {
    return memoryEntries().slice(0, capped);
  }
  return (await readLocalFileEvents()).slice(0, capped);
}

export function diagnosticMessageFromError(error: unknown): string {
  return safeErrorMessage(error);
}
