import { getDemoUniverse } from "@/server/demo/data/universe";
import { writeSpanSnapshot } from "@/server/span/store";
import type { SpanSnapshotMeta } from "@/server/span/types";
import { logInfo } from "@/server/logging";

export async function demoRefreshSpanSnapshot(_options?: {
  force?: boolean;
}): Promise<SpanSnapshotMeta> {
  const universe = getDemoUniverse();
  const today = universe.asOfDate.replaceAll("-", "");
  const meta = await writeSpanSnapshot(
    {
      date: today,
      variant: "demo",
      created: `${today}0000`,
    },
    universe.spanUnderlyings,
  );
  logInfo("Demo SPAN snapshot loaded", {
    date: meta.date,
    underlyingCount: meta.underlyingCount,
  });
  return meta;
}
