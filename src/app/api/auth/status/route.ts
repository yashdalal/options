import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCOUNT_DEFINITIONS,
} from "@/config/accounts";
import { getHighlightDefault, getSessionCookieName, hasKotakCredentials } from "@/config/env";
import {
  getActiveSessionId,
  getSessionState,
  listPublicAccountStatuses,
} from "@/server/session";

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const cookieSessionId = cookieStore.get(getSessionCookieName())?.value;
  const activeSessionId = getActiveSessionId();
  const state = getSessionState();
  const cookieMatches =
    Boolean(cookieSessionId) &&
    Boolean(activeSessionId) &&
    cookieSessionId === activeSessionId;

  const accounts = cookieMatches
    ? listPublicAccountStatuses()
    : ACCOUNT_DEFINITIONS.map((definition) => ({
        accountId: definition.id,
        label: definition.label,
        status: "disconnected" as const,
      }));

  const authenticated =
    cookieMatches &&
    state.status === "ready" &&
    accounts.every((account) => account.status === "connected");

  const expired = accounts.some((account) => account.status === "expired");

  return NextResponse.json({
    authenticated,
    status: authenticated
      ? "ready"
      : expired
        ? "expired"
        : state.status === "partial" && cookieMatches
          ? "partial"
          : "logged_out",
    highlightDefault: getHighlightDefault(),
    configured: hasKotakCredentials(),
    accounts,
  });
}
