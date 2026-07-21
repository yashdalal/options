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
    const globalStore = globalThis as typeof globalThis & {
      __nearExpirySessionStore?: { current: unknown };
    };
    delete globalStore.__nearExpirySessionStore;
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

    expect(() => session.requireConnectedAccounts(first.sessionId)).toThrow(/Login required/);

    loginWithTotp.mockResolvedValueOnce(credentials("gopa"));
    const second = await session.establishSession({ gopa: "444444" });

    expect(second.ready).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(loginWithTotp).toHaveBeenCalledTimes(4);
    expect(session.requireConnectedAccounts(second.sessionId).gopa.tradingSid).toBe("gopa-sid");
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

    session.markAccountExpired("gopa", "broker_403");
    expect(() => session.requireConnectedAccounts(established.sessionId)).toThrow(
      /Login required/,
    );

    const statuses = session.listPublicAccountStatuses();
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

    await session.establishSession({
      prakash: "111111",
      gopa: "222222",
      huf: "333333",
    });
    await session.clearSession();

    expect(logoutSession).toHaveBeenCalledTimes(3);
    expect(session.getSessionState().status).toBe("logged_out");
    expect(session.getActiveSessionId()).toBeNull();
  });
});
