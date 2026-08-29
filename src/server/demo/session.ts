import { randomUUID } from "node:crypto";
import {
  ACCOUNT_DEFINITIONS,
  type AccountId,
} from "@/config/accounts";
import type { TradeSessionCredentials } from "@/server/kotak/auth";
import { logInfo } from "@/server/logging";
import { readSession, writeSession } from "@/server/session-store";

const DEMO_BASE_URL = "https://cis.kotaksecurities.com";

type DemoAccountSlot = {
  accountId: AccountId;
  label: string;
  status: "connected" | "disconnected" | "expired";
  credentials: TradeSessionCredentials | null;
  reason?: string;
};

type DemoAggregateSession = {
  id: string;
  createdAt: number;
  accounts: Record<AccountId, DemoAccountSlot>;
};

export type DemoEstablishSessionResult = {
  sessionId: string;
  ready: boolean;
  accounts: Array<{
    accountId: AccountId;
    label: string;
    status: "connected" | "disconnected" | "expired";
    error?: string;
  }>;
};

export function demoTradeCredentials(accountId: AccountId): TradeSessionCredentials {
  return {
    accessToken: `demo-access-${accountId}`,
    tradingToken: `demo-trade-${accountId}`,
    tradingSid: `demo-sid-${accountId}`,
    baseUrl: DEMO_BASE_URL,
    neoFinKey: "neotradeapi",
  };
}

function emptySlots(): Record<AccountId, DemoAccountSlot> {
  const accounts = {} as Record<AccountId, DemoAccountSlot>;
  for (const definition of ACCOUNT_DEFINITIONS) {
    accounts[definition.id] = {
      accountId: definition.id,
      label: definition.label,
      status: "disconnected",
      credentials: null,
    };
  }
  return accounts;
}

function buildReadyDemoSession(sessionId?: string): DemoAggregateSession {
  const accounts = emptySlots();
  for (const definition of ACCOUNT_DEFINITIONS) {
    accounts[definition.id] = {
      accountId: definition.id,
      label: definition.label,
      status: "connected",
      credentials: demoTradeCredentials(definition.id),
    };
  }
  return {
    id: sessionId ?? randomUUID(),
    createdAt: Date.now(),
    accounts,
  };
}

function isReady(session: DemoAggregateSession): boolean {
  return ACCOUNT_DEFINITIONS.every(
    (definition) =>
      session.accounts[definition.id]?.status === "connected" &&
      session.accounts[definition.id]?.credentials,
  );
}

export async function ensureDemoSession(
  existingSessionId?: string,
): Promise<string> {
  if (existingSessionId) {
    const existing = await readSession(existingSessionId);
    if (existing && isReady(existing)) {
      return existingSessionId;
    }
  }

  const session = buildReadyDemoSession(existingSessionId);
  await writeSession(session);
  logInfo("Demo session ready", { sessionId: session.id });
  return session.id;
}

export async function establishDemoSession(
  totps: Partial<Record<AccountId, string>>,
  existingSessionId?: string,
): Promise<DemoEstablishSessionResult> {
  const existing = existingSessionId
    ? await readSession(existingSessionId)
    : null;

  const session: DemoAggregateSession = existing
    ? {
        id: existing.id,
        createdAt: existing.createdAt,
        accounts: { ...emptySlots(), ...existing.accounts },
      }
    : {
        id: randomUUID(),
        createdAt: Date.now(),
        accounts: emptySlots(),
      };

  const requested = ACCOUNT_DEFINITIONS.filter((definition) =>
    Boolean(totps[definition.id]),
  );
  const toConnect =
    requested.length > 0 ? requested : [...ACCOUNT_DEFINITIONS];

  for (const definition of toConnect) {
    session.accounts[definition.id] = {
      accountId: definition.id,
      label: definition.label,
      status: "connected",
      credentials: demoTradeCredentials(definition.id),
    };
  }

  await writeSession(session);

  return {
    sessionId: session.id,
    ready: isReady(session),
    accounts: ACCOUNT_DEFINITIONS.map((definition) => ({
      accountId: definition.id,
      label: definition.label,
      status: session.accounts[definition.id].status,
    })),
  };
}
