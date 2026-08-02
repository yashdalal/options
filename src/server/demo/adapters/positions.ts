import type { AccountId } from "@/config/accounts";
import type { TradeSessionCredentials } from "@/server/kotak/auth";
import type { RawPosition } from "@/server/kotak/positions";
import { getDemoUniverse } from "@/server/demo/data/universe";

function accountIdFromSession(session: TradeSessionCredentials): AccountId {
  const match = /demo-trade-(prakash|gopa|huf)/.exec(session.tradingToken);
  if (!match) {
    return "prakash";
  }
  return match[1] as AccountId;
}

export async function demoFetchPositions(
  session: TradeSessionCredentials,
  _requestId?: string,
  accountId?: string,
): Promise<RawPosition[]> {
  const universe = getDemoUniverse();
  const id = (accountId as AccountId | undefined) ?? accountIdFromSession(session);
  return universe.positionsByAccount[id] ?? [];
}
