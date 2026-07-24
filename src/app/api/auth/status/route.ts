import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCOUNT_DEFINITIONS,
} from "@/config/accounts";
import { getHighlightDefault, getSessionCookieName, hasKotakCredentials } from "@/config/env";
import {
  getSessionState,
  listPublicAccountStatuses,
} from "@/server/session";

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(getSessionCookieName())?.value;
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
    accounts,
  });
}
