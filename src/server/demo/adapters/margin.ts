import type { TradeSessionCredentials } from "@/server/kotak/auth";
import type {
  CheckMarginInput,
  CheckMarginResult,
} from "@/server/kotak/margin";

export async function demoCheckMargin(
  _session: TradeSessionCredentials,
  input: CheckMarginInput,
): Promise<CheckMarginResult> {
  const notional = Math.abs(input.price * input.quantity);
  const totalMarginUsed = Number(Math.max(100, notional * 0.12).toFixed(2));
  return {
    instrumentToken: input.instrumentToken,
    totalMarginUsed,
    raw: {
      data: {
        ordMrgn: totalMarginUsed,
        demo: true,
      },
    },
  };
}
