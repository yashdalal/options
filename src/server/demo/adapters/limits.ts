import type { AccountId } from "@/config/accounts";
import type { TradeSessionCredentials } from "@/server/kotak/auth";

const USED_MARGIN_BY_ACCOUNT: Record<AccountId, number> = {
  prakash: 286_450.75,
  gopa: 194_820.5,
  huf: 351_275.25,
};

function accountIdFromSession(session: TradeSessionCredentials): AccountId {
  const match = /demo-trade-(prakash|gopa|huf)/.exec(session.tradingToken);
  return (match?.[1] as AccountId | undefined) ?? "prakash";
}

export async function demoFetchUsedMargin(
  session: TradeSessionCredentials,
): Promise<number> {
  const accountId = accountIdFromSession(session);
  return USED_MARGIN_BY_ACCOUNT[accountId];
}
