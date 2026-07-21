import { z } from "zod";
import { getEnv } from "@/config/env";
import { assertApprovedBaseUrl, kotakFetch } from "./client";
import { detectBrokerFailure } from "./broker-response";
import { KotakApiError } from "./errors";
import { logError } from "../logging";

const loginResponseSchema = z.object({
  data: z.object({
    token: z.string().min(1),
    sid: z.string().min(1),
    kType: z.string().optional(),
    status: z.string().optional(),
  }),
});

const validateResponseSchema = z.object({
  data: z.object({
    token: z.string().min(1),
    sid: z.string().min(1),
    baseUrl: z.string().url(),
    hsServerId: z.union([z.string(), z.number()]).optional(),
    kType: z.string().optional(),
    status: z.string().optional(),
  }),
});

function assertAuthSuccess(payload: unknown, step: string): void {
  const failure = detectBrokerFailure(payload);
  if (!failure) {
    return;
  }

  logError(`Kotak ${step} rejected`, payload);
  throw new KotakApiError(failure.message || `${step} failed`, 401, "auth_failed", payload);
}

export type TradeSessionCredentials = {
  accessToken: string;
  tradingToken: string;
  tradingSid: string;
  baseUrl: string;
  neoFinKey: string;
};

type ViewSession = {
  viewToken: string;
  viewSid: string;
};

async function totpLogin(totp: string): Promise<ViewSession> {
  const env = getEnv();
  const url = `${env.KOTAK_LOGIN_BASE_URL}/login/1.0/tradeApiLogin`;
  const payload = await kotakFetch(url, {
    method: "POST",
    headers: {
      Authorization: env.KOTAK_ACCESS_TOKEN,
      "neo-fin-key": env.KOTAK_NEO_FIN_KEY,
    },
    body: {
      mobileNumber: env.KOTAK_MOBILE_NUMBER,
      ucc: env.KOTAK_UCC,
      totp,
    },
  });

  assertAuthSuccess(payload, "TOTP login");
  const parsed = loginResponseSchema.safeParse(payload);
  if (!parsed.success) {
    logError("Unexpected Kotak TOTP login response shape", payload);
    throw new KotakApiError("Unexpected login response", 500, "invalid_response", payload);
  }

  return {
    viewToken: parsed.data.data.token,
    viewSid: parsed.data.data.sid,
  };
}

async function validateMpin(view: ViewSession): Promise<TradeSessionCredentials> {
  const env = getEnv();
  const url = `${env.KOTAK_LOGIN_BASE_URL}/login/1.0/tradeApiValidate`;
  const payload = await kotakFetch(url, {
    method: "POST",
    headers: {
      Authorization: env.KOTAK_ACCESS_TOKEN,
      "neo-fin-key": env.KOTAK_NEO_FIN_KEY,
      sid: view.viewSid,
      Auth: view.viewToken,
    },
    body: {
      mpin: env.KOTAK_MPIN,
    },
  });

  assertAuthSuccess(payload, "MPIN validate");
  const parsed = validateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    logError("Unexpected Kotak MPIN validate response shape", payload);
    throw new KotakApiError("Unexpected validate response", 500, "invalid_response", payload);
  }

  const hasSessionRoute = String(parsed.data.data.hsServerId ?? "").trim().length > 0;
  const baseUrl = assertApprovedBaseUrl(
    hasSessionRoute ? parsed.data.data.baseUrl : env.KOTAK_LOGIN_BASE_URL,
  );

  return {
    accessToken: env.KOTAK_ACCESS_TOKEN,
    tradingToken: parsed.data.data.token,
    tradingSid: parsed.data.data.sid,
    baseUrl,
    neoFinKey: env.KOTAK_NEO_FIN_KEY,
  };
}

export async function loginWithTotp(totp: string): Promise<TradeSessionCredentials> {
  const view = await totpLogin(totp);
  return validateMpin(view);
}

export async function logoutSession(session: TradeSessionCredentials): Promise<void> {
  try {
    await kotakFetch(`${session.baseUrl}/quick/user/logout`, {
      method: "POST",
      headers: {
        Auth: session.tradingToken,
        Sid: session.tradingSid,
        "neo-fin-key": session.neoFinKey,
      },
      retries: 0,
    });
  } catch {
    // Best-effort logout; session is discarded locally regardless.
  }
}
