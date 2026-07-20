import { z } from "zod";
import { getEnv } from "@/config/env";
import { assertApprovedBaseUrl, kotakFetch } from "./client";
import { KotakApiError } from "./errors";

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
    kType: z.string().optional(),
    status: z.string().optional(),
  }),
});

export type TradeSessionCredentials = {
  accessToken: string;
  tradingToken: string;
  tradingSid: string;
  baseUrl: string;
  neoFinKey: string;
};

export type ViewSession = {
  viewToken: string;
  viewSid: string;
};

export async function totpLogin(totp: string): Promise<ViewSession> {
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

  const parsed = loginResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new KotakApiError("Unexpected login response", 500, "invalid_response");
  }

  return {
    viewToken: parsed.data.data.token,
    viewSid: parsed.data.data.sid,
  };
}

export async function validateMpin(view: ViewSession): Promise<TradeSessionCredentials> {
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

  const parsed = validateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new KotakApiError("Unexpected validate response", 500, "invalid_response");
  }

  const baseUrl = assertApprovedBaseUrl(parsed.data.data.baseUrl);

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
