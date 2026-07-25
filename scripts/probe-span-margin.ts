import { config } from "dotenv";
import { computePortfolioMargin } from "../src/server/span/engine";
import { probeSpanFetch, refreshSpanSnapshot } from "../src/server/span/fetch";
import { readSpanUnderlyings } from "../src/server/span/store";

config({ path: ".env.local" });
config();

async function main(): Promise<void> {
  const probe = await probeSpanFetch();
  console.log("probe", probe);
  if (!probe.ok) {
    process.exitCode = 1;
    return;
  }

  const meta = await refreshSpanSnapshot({ force: true });
  console.log("cached", {
    date: meta.date,
    variant: meta.variant,
    underlyingCount: meta.underlyingCount,
  });

  const loaded = await readSpanUnderlyings(["RELIANCE", "NIFTY"]);
  if (!loaded) {
    throw new Error("snapshot missing after refresh");
  }
  const reliance = loaded.underlyings.get("RELIANCE");
  const call = reliance?.contracts.find(
    (contract) =>
      contract.instrumentType === "OPT" &&
      contract.optionType === "C" &&
      contract.expiry === `${meta.date.slice(0, 4)}0728`,
  );
  if (!call || call.strike === undefined) {
    console.log("No RELIANCE Jul sample call found; snapshot ok");
    return;
  }

  const lotSize = 250;
  const margin = computePortfolioMargin(
    [
      {
        underlying: "RELIANCE",
        instrumentType: "OPT",
        optionType: "CALL",
        expiryIso: `${call.expiry.slice(0, 4)}-${call.expiry.slice(4, 6)}-${call.expiry.slice(6, 8)}`,
        strike: call.strike,
        quantity: -lotSize,
      },
      {
        underlying: "RELIANCE",
        instrumentType: "OPT",
        optionType: "PUT",
        expiryIso: `${call.expiry.slice(0, 4)}-${call.expiry.slice(4, 6)}-${call.expiry.slice(6, 8)}`,
        strike: call.strike,
        quantity: -lotSize,
      },
    ],
    loaded.underlyings,
  );
  console.log("sample short straddle", {
    strike: call.strike,
    expiry: call.expiry,
    margin,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
