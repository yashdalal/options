import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCredentials } from "@/config/env";
import type { TradeSessionCredentials } from "@/server/kotak/auth";
import { KotakApiError } from "@/server/kotak/errors";

const loginWithTotp = vi.fn<
  (account: AccountCredentials, totp: string) => Promise<TradeSessionCredentials>
>();
const logoutSession = vi.fn<(session: TradeSessionCredentials) => Promise<void>>();

vi.mock("@/server/kotak/auth", () => ({
  loginWithTotp,
  logoutSession,
}));

vi.mock("@/config/env", async () => {
  const accountsModule = await import("@/config/accounts");
  const accounts: AccountCredentials[] = accountsModule.ACCOUNT_DEFINITIONS.map(
    (definition) => ({
      id: definition.id,
      label: definition.label,
      accessToken: `${definition.id}-token`,
      mobileNumber: "+919876543210",
      ucc: `${definition.id}-ucc`,
      mpin: "123456",
    }),
  );

  return {
    getAccountCredentials: (accountId: string) => {
      const account = accounts.find((item) => item.id === accountId);
      if (!account) {
        throw new Error(`Unknown account id: ${accountId}`);
      }
      return account;
    },
    listAccountCredentials: () => accounts,
  };
});

function credentials(accountId: string): TradeSessionCredentials {
  return {
    accessToken: `${accountId}-token`,
    tradingToken: `${accountId}-trade`,
    tradingSid: `${accountId}-sid`,
    baseUrl: "https://cis.kotaksecurities.com",
    neoFinKey: "neotradeapi",
  };
}

describe("aggregate session", () => {
  beforeEach(async () => {
    vi.resetModules();
    loginWithTotp.mockReset();
    logoutSession.mockReset();
    logoutSession.mockResolvedValue(undefined);
    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const { resetSessionStoreForTests } = await import("@/server/session-store");
    const { resetRedisClientForTests } = await import("@/server/redis");
    resetSessionStoreForTests();
    resetRedisClientForTests();
  });

  it("keeps successful accounts when one TOTP fails and allows retry", async () => {
    const session = await import("@/server/session");

    loginWithTotp
      .mockResolvedValueOnce(credentials("prakash"))
      .mockRejectedValueOnce(new KotakApiError("bad totp", 401, "auth_failed"))
      .mockResolvedValueOnce(credentials("huf"));

    const first = await session.establishSession({
      prakash: "111111",
      gopa: "222222",
      huf: "333333",
    });

    expect(first.ready).toBe(false);
    expect(first.accounts.find((account) => account.accountId === "prakash")?.status).toBe(
      "connected",
    );
    expect(first.accounts.find((account) => account.accountId === "gopa")?.status).toBe(
      "disconnected",
    );
    expect(first.accounts.find((account) => account.accountId === "huf")?.status).toBe(
      "connected",
    );

    await expect(session.requireConnectedAccounts(first.sessionId)).rejects.toThrow(
      /Login required/,
    );

    loginWithTotp.mockResolvedValueOnce(credentials("gopa"));
    const second = await session.establishSession({ gopa: "444444" }, first.sessionId);

    expect(second.ready).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(loginWithTotp).toHaveBeenCalledTimes(4);
    expect(
      (await session.requireConnectedAccounts(second.sessionId)).gopa.tradingSid,
    ).toBe("gopa-sid");
  });

  it("marks only the expired account and re-gates the report", async () => {
    const session = await import("@/server/session");

    loginWithTotp
      .mockResolvedValueOnce(credentials("prakash"))
      .mockResolvedValueOnce(credentials("gopa"))
      .mockResolvedValueOnce(credentials("huf"));

    const established = await session.establishSession({
      prakash: "111111",
      gopa: "222222",
      huf: "333333",
    });
    expect(established.ready).toBe(true);

    await session.markAccountExpired(established.sessionId, "gopa", "broker_403");
    await expect(
      session.requireConnectedAccounts(established.sessionId),
    ).rejects.toThrow(/Login required/);

    const statuses = await session.listPublicAccountStatuses(established.sessionId);
    expect(statuses.find((account) => account.accountId === "prakash")?.status).toBe(
      "connected",
    );
    expect(statuses.find((account) => account.accountId === "gopa")?.status).toBe("expired");
    expect(statuses.find((account) => account.accountId === "huf")?.status).toBe("connected");
  });

  it("logs out all connected broker sessions", async () => {
    const session = await import("@/server/session");

    loginWithTotp
      .mockResolvedValueOnce(credentials("prakash"))
      .mockResolvedValueOnce(credentials("gopa"))
      .mockResolvedValueOnce(credentials("huf"));

    const established = await session.establishSession({
      prakash: "111111",
      gopa: "222222",
      huf: "333333",
    });
    await session.clearSession(established.sessionId);

    expect(logoutSession).toHaveBeenCalledTimes(3);
    expect(await session.getSessionState(established.sessionId)).toEqual({
      status: "logged_out",
    });
  });

  it("fails visibly on Vercel when Redis is not configured", async () => {
    process.env.VERCEL = "1";
    const store = await import("@/server/session-store");
    await expect(store.readSession("missing")).rejects.toMatchObject({
      code: "session_store_unavailable",
      status: 500,
    });
  });
});
