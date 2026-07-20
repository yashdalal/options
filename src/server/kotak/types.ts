import type { MonitorSnapshot } from "@/domain/types";
import type { RawPosition } from "./positions";
import type { ClosingQuote, InstrumentRef } from "./quotes";
import type { ScripMasterRegistry } from "./scrip-master";
import type { TradeSessionCredentials } from "./auth";

export type BrokerAdapter = {
  login(totp: string): Promise<TradeSessionCredentials>;
  logout(session: TradeSessionCredentials): Promise<void>;
  getPositions(session: TradeSessionCredentials): Promise<RawPosition[]>;
  getScripMaster(session: TradeSessionCredentials): Promise<ScripMasterRegistry>;
  getClosingQuotes(
    session: TradeSessionCredentials,
    instruments: InstrumentRef[],
  ): Promise<ClosingQuote[]>;
};

export type MonitorPort = {
  getSnapshot(session: TradeSessionCredentials): Promise<MonitorSnapshot>;
};
