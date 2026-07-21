import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getHighlightDefault, getSessionCookieName, hasKotakCredentials } from "@/config/env";
import { getActiveSessionId, getSessionState } from "@/server/session";

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const cookieSessionId = cookieStore.get(getSessionCookieName())?.value;
  const activeSessionId = getActiveSessionId();
  const state = getSessionState();

  const authenticated =
    state.status === "trade_session" &&
    Boolean(cookieSessionId) &&
    cookieSessionId === activeSessionId;

  return NextResponse.json({
    authenticated,
    status: authenticated ? "trade_session" : state.status === "expired" ? "expired" : "logged_out",
    highlightDefault: getHighlightDefault(),
    configured: hasKotakCredentials(),
  });
}
