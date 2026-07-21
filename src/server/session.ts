import { randomUUID } from "node:crypto";
import {
  ACCOUNT_DEFINITIONS,
  type AccountId,
} from "@/config/accounts";
import { getAccountCredentials, listAccountCredentials } from "@/config/env";
import {
  loginWithTotp,
  logoutSession,
  type TradeSessionCredentials,
} from "./kotak/auth";
import { isKotakApiError } from "./kotak/errors";
import { mapLoginError } from "./login-errors";
import { logInfo, logWarn } from "./logging";

export type AccountConnectionStatus = "connected" | "disconnected" | "expired";

export type AccountSessionSlot = {
  accountId: AccountId;
  label: string;
  status: AccountConnectionStatus;
  credentials: TradeSessionCredentials | null;
  reason?: string;
};

export type AggregateSession = {
  id: string;
  createdAt: number;
  accounts: Record<AccountId, AccountSessionSlot>;
};

export type SessionStoreState =
  | { status: "logged_out" }
  | { status: "partial"; session: AggregateSession }
  | { status: "ready"; session: AggregateSession };

type SessionStore = {
  current: SessionStoreState;
};

export type AccountLoginResult = {
  accountId: AccountId;
  label: string;
  status: AccountConnectionStatus;
  error?: string;
};

export type EstablishSessionResult = {
  sessionId: string;
  ready: boolean;
  accounts: AccountLoginResult[];
};

const globalStore = globalThis as typeof globalThis & {
  __nearExpirySessionStore?: SessionStore;
};

function getStore(): SessionStore {
  if (!globalStore.__nearExpirySessionStore) {
    globalStore.__nearExpirySessionStore = { current: { status: "logged_out" } };
  }
  return globalStore.__nearExpirySessionStore;
}

function emptyAccountSlots(): Record<AccountId, AccountSessionSlot> {
  const slots = {} as Record<AccountId, AccountSessionSlot>;
  for (const definition of ACCOUNT_DEFINITIONS) {
    slots[definition.id] = {
      accountId: definition.id,
      label: definition.label,
      status: "disconnected",
      credentials: null,
    };
  }
  return slots;
}

function cloneSession(session: AggregateSession): AggregateSession {
  const accounts = emptyAccountSlots();
  for (const definition of ACCOUNT_DEFINITIONS) {
    const existing = session.accounts[definition.id];
    accounts[definition.id] = {
      accountId: existing.accountId,
      label: existing.label,
      status: existing.status,
      credentials: existing.credentials,
      reason: existing.reason,
    };
  }
  return {
    id: session.id,
    createdAt: session.createdAt,
    accounts,
  };
}

function deriveStoreStatus(session: AggregateSession): SessionStoreState {
  const ready = ACCOUNT_DEFINITIONS.every(
    (definition) => session.accounts[definition.id].status === "connected",
  );
  return ready
    ? { status: "ready", session }
    : { status: "partial", session };
}

function getOrCreateSession(): AggregateSession {
  const state = getStore().current;
  if (state.status === "partial" || state.status === "ready") {
    return cloneSession(state.session);
  }
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    accounts: emptyAccountSlots(),
  };
}

function toPublicAccount(slot: AccountSessionSlot): AccountLoginResult {
  return {
    accountId: slot.accountId,
    label: slot.label,
    status: slot.status,
    error: slot.reason,
  };
}

export function listPublicAccountStatuses(): AccountLoginResult[] {
  const state = getStore().current;
  if (state.status === "logged_out") {
    return ACCOUNT_DEFINITIONS.map((definition) => ({
      accountId: definition.id,
      label: definition.label,
      status: "disconnected" as const,
    }));
  }
  return ACCOUNT_DEFINITIONS.map((definition) =>
    toPublicAccount(state.session.accounts[definition.id]),
  );
}

export function getSessionState(): SessionStoreState {
  return getStore().current;
}

export function getActiveSessionId(): string | null {
  const state = getStore().current;
  if (state.status === "partial" || state.status === "ready") {
    return state.session.id;
  }
  return null;
}

export function isFullyAuthenticated(sessionId: string | undefined): boolean {
  const state = getStore().current;
  return (
    Boolean(sessionId) &&
    state.status === "ready" &&
    state.session.id === sessionId
  );
}

export function markAccountExpired(
  accountId: AccountId,
  reason = "session_expired",
): void {
  const state = getStore().current;
  if (state.status !== "partial" && state.status !== "ready") {
    return;
  }

  const session = cloneSession(state.session);
  session.accounts[accountId] = {
    ...session.accounts[accountId],
    status: "expired",
    credentials: null,
    reason,
  };
  getStore().current = deriveStoreStatus(session);
  logWarn("Broker account session expired", { accountId, reason });
}

export async function establishSession(
  totps: Partial<Record<AccountId, string>>,
): Promise<EstablishSessionResult> {
  const session = getOrCreateSession();
  const accountsToLogin = ACCOUNT_DEFINITIONS.filter((definition) => {
    const totp = totps[definition.id];
    if (!totp) {
      return false;
    }
    return session.accounts[definition.id].status !== "connected";
  });

  const results = await Promise.all(
    accountsToLogin.map(async (definition) => {
      const totp = totps[definition.id];
      if (!totp) {
        return null;
      }
      try {
        const credentials = await loginWithTotp(
          getAccountCredentials(definition.id),
          totp,
        );
        session.accounts[definition.id] = {
          accountId: definition.id,
          label: definition.label,
          status: "connected",
          credentials,
        };
        logInfo("Kotak trade session established", {
          accountId: definition.id,
          label: definition.label,
        });
        return toPublicAccount(session.accounts[definition.id]);
      } catch (error) {
        const mapped = mapLoginError(error);
        session.accounts[definition.id] = {
          accountId: definition.id,
          label: definition.label,
          status: "disconnected",
          credentials: null,
          reason: mapped.error,
        };
        return {
          ...toPublicAccount(session.accounts[definition.id]),
          error: mapped.error,
        };
      }
    }),
  );

  getStore().current = deriveStoreStatus(session);

  const publicAccounts = ACCOUNT_DEFINITIONS.map((definition) => {
    const attempted = results.find(
      (result) => result?.accountId === definition.id,
    );
    return attempted ?? toPublicAccount(session.accounts[definition.id]);
  });

  return {
    sessionId: session.id,
    ready: getStore().current.status === "ready",
    accounts: publicAccounts,
  };
}

export async function clearSession(): Promise<void> {
  const state = getStore().current;
  if (state.status === "partial" || state.status === "ready") {
    await Promise.all(
      listAccountCredentials().map(async (account) => {
        const slot = state.session.accounts[account.id];
        if (slot.credentials) {
          await logoutSession(slot.credentials);
        }
      }),
    );
  }
  getStore().current = { status: "logged_out" };
  logInfo("Kotak sessions cleared");
}

export function requireConnectedAccounts(
  sessionId: string | undefined,
): Record<AccountId, TradeSessionCredentials> {
  const state = getStore().current;
  if (!sessionId || state.status !== "ready" || state.session.id !== sessionId) {
    throw Object.assign(new Error("Login required"), {
      status: 401,
      code: "login_required",
    });
  }

  const credentials = {} as Record<AccountId, TradeSessionCredentials>;
  for (const definition of ACCOUNT_DEFINITIONS) {
    const slot = state.session.accounts[definition.id];
    if (slot.status !== "connected" || !slot.credentials) {
      throw Object.assign(new Error("Login required"), {
        status: 401,
        code: "login_required",
      });
    }
    credentials[definition.id] = slot.credentials;
  }
  return credentials;
}

export function handleBrokerAuthFailure(
  accountId: AccountId,
  error: unknown,
): never {
  if (isKotakApiError(error) && error.code === "session_expired") {
    markAccountExpired(accountId, "broker_403");
    throw Object.assign(new Error("Login required"), {
      status: 401,
      code: "login_required",
      accountId,
    });
  }
  throw error;
}
