import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_MAX_ENTRIES,
  listDiagnosticEvents,
  recordDiagnosticEvent,
  resetDiagnosticsForTests,
} from "@/server/diagnostics";
import { resetRedisClientForTests } from "@/server/redis";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "diagnostics-"));
  process.env.DIAGNOSTICS_FILE = path.join(tempDir, "diagnostics.jsonl");
  delete process.env.VERCEL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  resetRedisClientForTests();
  resetDiagnosticsForTests();
});

afterEach(async () => {
  delete process.env.DIAGNOSTICS_FILE;
  await rm(tempDir, { recursive: true, force: true });
});

describe("diagnostics", () => {
  it("writes redacted events to the local file when Redis is not configured", async () => {
    await recordDiagnosticEvent({
      kind: "screen_snapshot",
      requestId: "req-1",
      symbol: "MARUTI",
      message: "token eyJhbGciOiJIUzI1NiJ9.aaa.bbb expired",
      detail: { authorization: "secret-token", tokens: ["nse_fo|123"] },
    });

    const events = await listDiagnosticEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0]?.symbol).toBe("MARUTI");
    expect(events[0]?.message).toContain("[REDACTED]");
    expect(events[0]?.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(events[0]?.detail).toEqual({
      authorization: "[REDACTED]",
      tokens: ["nse_fo|123"],
    });
  });

  it("lists newest first and respects the limit", async () => {
    for (let index = 0; index < 3; index += 1) {
      await recordDiagnosticEvent({ kind: "quote_empty_batch", message: `empty-${index}` });
    }

    const events = await listDiagnosticEvents(2);
    expect(events.map((event) => event.message)).toEqual(["empty-2", "empty-1"]);
  });

  it("caps the local file at the max entry count", async () => {
    for (let index = 0; index < DIAGNOSTICS_MAX_ENTRIES + 3; index += 1) {
      await recordDiagnosticEvent({ kind: "quote_batch", message: `batch-${index}` });
    }

    const events = await listDiagnosticEvents(DIAGNOSTICS_MAX_ENTRIES);
    expect(events).toHaveLength(DIAGNOSTICS_MAX_ENTRIES);
    expect(events[0]?.message).toBe(`batch-${DIAGNOSTICS_MAX_ENTRIES + 2}`);
  });

  it("keeps events in instance memory on Vercel without Redis", async () => {
    process.env.VERCEL = "1";
    await recordDiagnosticEvent({ kind: "monitor", message: "positions failed" });

    const events = await listDiagnosticEvents(5);
    expect(events.map((event) => event.message)).toEqual(["positions failed"]);
  });
});
