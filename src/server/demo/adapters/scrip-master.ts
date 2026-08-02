import type { TradeSessionCredentials } from "@/server/kotak/auth";
import {
  buildScripMasterRegistryFromInstruments,
  type ScripMasterRegistry,
} from "@/server/kotak/scrip-master";
import { getDemoUniverse } from "@/server/demo/data/universe";

export async function demoLoadScripMasterRegistry(
  _session: TradeSessionCredentials,
): Promise<ScripMasterRegistry> {
  const universe = getDemoUniverse();
  return buildScripMasterRegistryFromInstruments(
    universe.asOfDate,
    universe.scripInstruments,
  );
}
