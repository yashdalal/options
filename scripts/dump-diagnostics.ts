import { config } from "dotenv";
import {
  listDiagnosticEvents,
  resetDiagnosticsForTests,
} from "../src/server/diagnostics";
import { isRedisConfigured, resetRedisClientForTests } from "../src/server/redis";

config({ path: ".env.local" });
config();
resetRedisClientForTests();
resetDiagnosticsForTests();

async function main(): Promise<void> {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 50;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive number");
  }

  console.log(
    isRedisConfigured()
      ? "Reading diagnostics from Upstash Redis (shared with Vercel)."
      : "Redis is not configured; reading local .cache/diagnostics.jsonl from `npm run dev`.",
  );

  const events = await listDiagnosticEvents(limit);
  if (events.length === 0) {
    console.log("No diagnostic events found.");
    return;
  }

  console.log(`Showing ${events.length} diagnostic event(s):`);
  for (const event of events) {
    console.log(JSON.stringify(event));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
