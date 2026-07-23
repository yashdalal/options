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
  const activeSessionId = getActiveSessionId();
  const state = getSessionState();
  let cookieSessionId = cookieStore.get(getSessionCookieName())?.value;

  if (
    state.status === "ready" &&
    activeSessionId &&
    cookieSessionId !== activeSessionId
  ) {
    cookieStore.set(getSessionCookieName(), activeSessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    cookieSessionId = activeSessionId;
  }

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
