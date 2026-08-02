import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCOUNT_DEFINITIONS,
} from "@/config/accounts";
import { getHighlightDefault, getSessionCookieName, hasKotakCredentials } from "@/config/env";
import { isDemoMode } from "@/server/demo/mode";
import { ensureDemoSession } from "@/server/demo/session";
import {
  getSessionState,
  listPublicAccountStatuses,
} from "@/server/session";

function setSessionCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  sessionId: string,
): void {
  cookieStore.set(getSessionCookieName(), sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const demo = isDemoMode();
  let sessionId = cookieStore.get(getSessionCookieName())?.value;

  if (demo) {
    const ensured = await ensureDemoSession(sessionId);
    if (ensured !== sessionId) {
      setSessionCookie(cookieStore, ensured);
      sessionId = ensured;
    }
  }

  const state = await getSessionState(sessionId);
  const accounts =
    state.status === "logged_out"
      ? ACCOUNT_DEFINITIONS.map((definition) => ({
          accountId: definition.id,
          label: definition.label,
          status: "disconnected" as const,
        }))
      : await listPublicAccountStatuses(sessionId);

  const authenticated =
    state.status === "ready" &&
    accounts.every((account) => account.status === "connected");

  const expired = accounts.some((account) => account.status === "expired");

  return NextResponse.json({
    authenticated,
    status: authenticated
      ? "ready"
      : expired
        ? "expired"
        : state.status === "partial"
          ? "partial"
          : "logged_out",
    highlightDefault: getHighlightDefault(),
    configured: hasKotakCredentials(),
    demo,
    accounts,
  });
}
