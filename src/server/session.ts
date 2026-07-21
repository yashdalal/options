import { randomUUID } from "node:crypto";
import {
  loginWithTotp,
  logoutSession,
  type TradeSessionCredentials,
} from "./kotak/auth";
import { isKotakApiError } from "./kotak/errors";
import { logInfo, logWarn } from "./logging";

export type SessionState =
  | { status: "logged_out" }
  | { status: "trade_session"; id: string; credentials: TradeSessionCredentials; createdAt: number }
  | { status: "expired"; reason: string };

type SessionStore = {
  current: SessionState;
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

export function getSessionState(): SessionState {
  return getStore().current;
}

export function getActiveSessionId(): string | null {
  const state = getStore().current;
  return state.status === "trade_session" ? state.id : null;
}

export function markSessionExpired(reason = "session_expired"): void {
  getStore().current = { status: "expired", reason };
}

export async function establishSession(totp: string): Promise<{ sessionId: string }> {
  const credentials = await loginWithTotp(totp);
  const sessionId = randomUUID();
  getStore().current = {
    status: "trade_session",
    id: sessionId,
    credentials,
    createdAt: Date.now(),
  };
  logInfo("Kotak trade session established");
  return { sessionId };
}

export async function clearSession(): Promise<void> {
  const state = getStore().current;
  if (state.status === "trade_session") {
    await logoutSession(state.credentials);
  }
  getStore().current = { status: "logged_out" };
  logInfo("Kotak session cleared");
}

export function requireSession(sessionId: string | undefined): TradeSessionCredentials {
  const state = getStore().current;
  if (!sessionId || state.status !== "trade_session" || state.id !== sessionId) {
    throw Object.assign(new Error("Login required"), { status: 401, code: "login_required" });
  }
  return state.credentials;
}

export function handleBrokerAuthFailure(error: unknown): never {
  if (isKotakApiError(error) && error.code === "session_expired") {
    markSessionExpired("broker_403");
    logWarn("Broker session expired");
    throw Object.assign(new Error("Login required"), { status: 401, code: "login_required" });
  }
  throw error;
}
