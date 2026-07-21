import { isKotakApiError } from "@/server/kotak/errors";
import { logError, safeErrorMessage } from "@/server/logging";

const CONSUMER_KEY_MESSAGE =
  "Kotak rejected the API token (Consumer Key / Access Token). In Neo → More → TradeAPI → API Dashboard, Create Application and paste the generated token into the matching KOTAK_<ACCOUNT>_ACCESS_TOKEN with no Bearer prefix. Then complete TOTP Registration for that account, restart npm run dev, and try a fresh TOTP.";

export type LoginErrorResponse = {
  status: number;
  error: string;
};

export function mapLoginError(error: unknown): LoginErrorResponse {
  const kotak = isKotakApiError(error) ? error : null;

  logError("Login failed", {
    message: safeErrorMessage(error),
    status: kotak?.status,
    code: kotak?.code,
    details: kotak?.details,
  });

  if (error instanceof Error && error.message.startsWith("Invalid environment configuration")) {
    return {
      status: 500,
      error: "Check .env.local values (mobile must be +91XXXXXXXXXX, MPIN 6 digits)",
    };
  }

  if (kotak) {
    const authFailure =
      kotak.code === "auth_failed" ||
      kotak.code === "bad_request" ||
      kotak.status === 401 ||
      kotak.status === 403 ||
      kotak.status === 424;

    let message =
      kotak.message ||
      "Authentication failed. Check TOTP, access token, UCC, mobile, and MPIN.";

    if (kotak.status === 424 || /consumer key/i.test(kotak.message)) {
      message = CONSUMER_KEY_MESSAGE;
    }

    return {
      status: authFailure ? 401 : 500,
      error: authFailure
        ? message
        : "Unable to authenticate with Kotak. Check the server terminal for details.",
    };
  }

  return {
    status: 500,
    error: "Unable to authenticate. Check the server terminal for details.",
  };
}
