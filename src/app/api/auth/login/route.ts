import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCOUNT_IDS } from "@/config/accounts";
import { getSessionCookieName, hasKotakCredentials } from "@/config/env";
import { establishSession } from "@/server/session";

const totpSchema = z.string().regex(/^\d{6}$/);

const bodySchema = z.object({
  totps: z
    .object({
      prakash: totpSchema.optional(),
      gopa: totpSchema.optional(),
      huf: totpSchema.optional(),
    })
    .refine(
      (value) => ACCOUNT_IDS.some((accountId) => Boolean(value[accountId])),
      { message: "Provide at least one TOTP" },
    ),
});

export async function POST(request: Request): Promise<Response> {
  try {
    if (!hasKotakCredentials()) {
      return NextResponse.json(
        { error: "Server is missing Kotak credentials in .env.local" },
        { status: 500 },
      );
    }

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter valid 6-digit TOTPs for the accounts you are connecting" },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const existingSessionId = cookieStore.get(getSessionCookieName())?.value;
    const result = await establishSession(
      parsed.data.totps,
      existingSessionId,
    );
    cookieStore.set(getSessionCookieName(), result.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    const attemptedIds = ACCOUNT_IDS.filter((accountId) =>
      Boolean(parsed.data.totps[accountId]),
    );
    const failedAttempts = result.accounts.filter(
      (account) =>
        attemptedIds.includes(account.accountId) && account.status !== "connected",
    );

    return NextResponse.json({
      status: result.ready ? "authenticated" : "partial",
      ready: result.ready,
      accounts: result.accounts,
      error: failedAttempts.length
        ? failedAttempts
            .map((account) => account.error ?? `Could not connect ${account.label}`)
            .join("; ")
        : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.startsWith("Invalid environment configuration")
            ? "Check .env.local values (mobile must be +91XXXXXXXXXX, MPIN 6 digits)"
            : "Unable to authenticate. Check the server terminal for details.",
      },
      { status: 500 },
    );
  }
}
