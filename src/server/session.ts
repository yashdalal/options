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
import {
  deleteSession,
  readSession,
  writeSession,
} from "./session-store";

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

function toPublicAccount(slot: AccountSessionSlot): AccountLoginResult {
  return {
    accountId: slot.accountId,
    label: slot.label,
    status: slot.status,
    error: slot.reason,
  };
}

function loginRequiredError(accountId?: AccountId): Error {
  return Object.assign(new Error("Login required"), {
    status: 401,
    code: "login_required",
    accountId,
  });
}

export async function getSessionState(
  sessionId: string | undefined,
): Promise<SessionStoreState> {
  if (!sessionId) {
    return { status: "logged_out" };
  }
  const session = await readSession(sessionId);
  if (!session) {
    return { status: "logged_out" };
  }
  return deriveStoreStatus(session);
}

export async function listPublicAccountStatuses(
  sessionId: string | undefined,
): Promise<AccountLoginResult[]> {
  const state = await getSessionState(sessionId);
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

export async function markAccountExpired(
  sessionId: string | undefined,
  accountId: AccountId,
  reason = "session_expired",
): Promise<void> {
  if (!sessionId) {
    return;
  }
  const existing = await readSession(sessionId);
  if (!existing) {
    return;
  }

  const session = cloneSession(existing);
  session.accounts[accountId] = {
    ...session.accounts[accountId],
    status: "expired",
    credentials: null,
    reason,
  };
  await writeSession(session);
  logWarn("Broker account session expired", { accountId, reason, sessionId });
}

export async function establishSession(
  totps: Partial<Record<AccountId, string>>,
  existingSessionId?: string,
): Promise<EstablishSessionResult> {
  const existing = existingSessionId
    ? await readSession(existingSessionId)
    : null;
  const session = existing
    ? cloneSession(existing)
    : {
        id: randomUUID(),
        createdAt: Date.now(),
        accounts: emptyAccountSlots(),
      };

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

  await writeSession(session);
  const state = deriveStoreStatus(session);

  const publicAccounts = ACCOUNT_DEFINITIONS.map((definition) => {
    const attempted = results.find(
      (result) => result?.accountId === definition.id,
    );
    return attempted ?? toPublicAccount(session.accounts[definition.id]);
  });

  return {
    sessionId: session.id,
    ready: state.status === "ready",
    accounts: publicAccounts,
  };
}

export async function clearSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) {
    return;
  }

  const existing = await readSession(sessionId);
  if (existing) {
    await Promise.all(
      listAccountCredentials().map(async (account) => {
        const slot = existing.accounts[account.id];
        if (slot.credentials) {
          await logoutSession(slot.credentials);
        }
      }),
    );
  }
  await deleteSession(sessionId);
  logInfo("Kotak sessions cleared", { sessionId });
}

export async function requireConnectedAccounts(
  sessionId: string | undefined,
): Promise<Record<AccountId, TradeSessionCredentials>> {
  if (!sessionId) {
    throw loginRequiredError();
  }

  const existing = await readSession(sessionId);
  if (!existing) {
    throw loginRequiredError();
  }

  const state = deriveStoreStatus(existing);
  if (state.status !== "ready") {
    throw loginRequiredError();
  }

  const credentials = {} as Record<AccountId, TradeSessionCredentials>;
  for (const definition of ACCOUNT_DEFINITIONS) {
    const slot = existing.accounts[definition.id];
    if (slot.status !== "connected" || !slot.credentials) {
      throw loginRequiredError(definition.id);
    }
    credentials[definition.id] = slot.credentials;
  }
  return credentials;
}

export async function handleBrokerAuthFailure(
  sessionId: string | undefined,
  accountId: AccountId,
  error: unknown,
): Promise<never> {
  if (isKotakApiError(error) && error.code === "session_expired") {
    await markAccountExpired(sessionId, accountId, "broker_403");
    throw loginRequiredError(accountId);
  }
  throw error;
}
