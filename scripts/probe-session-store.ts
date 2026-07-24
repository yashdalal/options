import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { ACCOUNT_DEFINITIONS } from "../src/config/accounts";
import { isRedisConfigured, resetRedisClientForTests } from "../src/server/redis";
import {
  deleteSession,
  readSession,
  resetSessionStoreForTests,
  writeSession,
} from "../src/server/session-store";
import type { AggregateSession } from "../src/server/session";

config({ path: ".env.local" });
config();
resetRedisClientForTests();
resetSessionStoreForTests();

function emptySession(id: string): AggregateSession {
  const accounts = {} as AggregateSession["accounts"];
  for (const definition of ACCOUNT_DEFINITIONS) {
    accounts[definition.id] = {
      accountId: definition.id,
      label: definition.label,
      status: "disconnected",
      credentials: null,
    };
  }
  return { id, createdAt: Date.now(), accounts };
}

async function main(): Promise<void> {
  if (!isRedisConfigured()) {
    console.error(
      "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*).\n" +
        "Add them to .env.local (vercel env pull .env.local) then retry.",
    );
    process.exit(1);
  }

  const sessionId = `probe-${randomUUID()}`;
  const session = emptySession(sessionId);

  console.log("Writing probe session to Upstash Redis...", { sessionId });
  await writeSession(session);

  const loaded = await readSession(sessionId);
  if (!loaded || loaded.id !== sessionId) {
    throw new Error("Redis read did not return the written session");
  }
  console.log("Read back OK");

  await deleteSession(sessionId);
  const afterDelete = await readSession(sessionId);
  if (afterDelete !== null) {
    throw new Error("Redis delete left the session behind");
  }
  console.log("Deleted OK — Redis session store is working locally");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
