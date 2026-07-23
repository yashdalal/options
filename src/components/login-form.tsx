"use client";

import { useMemo, useState } from "react";
import {
  ACCOUNT_DEFINITIONS,
  type AccountId,
} from "@/config/accounts";

export type AccountAuthStatus = {
  accountId: AccountId;
  label: string;
  status: "connected" | "disconnected" | "expired";
  error?: string;
};

type LoginFormProps = {
  accounts: AccountAuthStatus[];
  onStatusChange: () => void;
};

type TotpMap = Record<AccountId, string>;

function emptyTotps(): TotpMap {
  return {
    prakash: "",
    gopa: "",
    huf: "",
  };
}

export function LoginForm({ accounts, onStatusChange }: LoginFormProps) {
  const [totps, setTotps] = useState<TotpMap>(emptyTotps);
  const [accountErrors, setAccountErrors] = useState<Partial<Record<AccountId, string>>>({});
  const [pendingAccountId, setPendingAccountId] = useState<AccountId | null>(null);
  const [justConnected, setJustConnected] = useState<Partial<Record<AccountId, true>>>({});

  const accountStatuses = useMemo(() => {
    const byId = new Map(accounts.map((account) => [account.accountId, account]));
    return ACCOUNT_DEFINITIONS.map((definition) => {
      const current = byId.get(definition.id);
      return {
        accountId: definition.id,
        label: definition.label,
        status: current?.status ?? ("disconnected" as const),
        error: current?.error,
      };
    });
  }, [accounts]);

  const connectedCount = accountStatuses.filter(
    (account) => account.status === "connected",
  ).length;

  async function connectAccount(accountId: AccountId) {
    const totp = totps[accountId];
    if (totp.length !== 6) {
      return;
    }

    setPendingAccountId(accountId);
    setAccountErrors((current) => {
      const next = { ...current };
      delete next[accountId];
      return next;
    });

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totps: { [accountId]: totp } }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ready?: boolean;
        accounts?: AccountAuthStatus[];
      };

      const result = payload.accounts?.find((account) => account.accountId === accountId);
      if (result?.status === "connected") {
        setTotps((current) => ({ ...current, [accountId]: "" }));
        setJustConnected((current) => ({ ...current, [accountId]: true }));
      } else {
        setAccountErrors((current) => ({
          ...current,
          [accountId]: result?.error ?? payload.error ?? "Authentication failed",
        }));
      }

      onStatusChange();
    } catch {
      setAccountErrors((current) => ({
        ...current,
        [accountId]: "Unable to reach the server",
      }));
    } finally {
      setPendingAccountId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Near Expiry Monitor</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Connect each account separately with its current TOTP. Sessions are saved as you go,
          so codes do not need to be entered at the same time. The report opens when Prakash,
          Gopa, and HUF are all connected.
        </p>
        <p className="mt-2 text-sm font-medium text-zinc-800">
          Connected {connectedCount} of {ACCOUNT_DEFINITIONS.length}
        </p>
      </div>

      {accountStatuses.map((account) => {
        const connected = account.status === "connected";
        const pending = pendingAccountId === account.accountId;
        const fieldError = accountErrors[account.accountId] ?? account.error;
        const totp = totps[account.accountId];

        return (
          <div
            key={account.accountId}
            className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <label
                htmlFor={`totp-${account.accountId}`}
                className="text-sm font-medium text-zinc-800"
              >
                {account.label}
              </label>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  connected
                    ? "bg-emerald-100 text-emerald-800"
                    : account.status === "expired"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-zinc-200 text-zinc-700"
                }`}
              >
                {connected
                  ? "Connected"
                  : account.status === "expired"
                    ? "Expired"
                    : "Needs TOTP"}
              </span>
            </div>

            {connected ? (
              <p className="text-sm text-emerald-700">
                {justConnected[account.accountId]
                  ? "Login successful."
                  : "Already signed in for this account."}
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id={`totp-${account.accountId}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totp}
                  onChange={(event) =>
                    setTotps((current) => ({
                      ...current,
                      [account.accountId]: event.target.value.replace(/\D/g, "").slice(0, 6),
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && totp.length === 6 && !pendingAccountId) {
                      event.preventDefault();
                      void connectAccount(account.accountId);
                    }
                  }}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base tracking-[0.3em] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="123456"
                />
                <button
                  type="button"
                  onClick={() => void connectAccount(account.accountId)}
                  disabled={pendingAccountId !== null || totp.length !== 6}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold whitespace-nowrap text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {pending ? "Connecting…" : `Connect ${account.label}`}
                </button>
              </div>
            )}

            {fieldError && !connected ? (
              <p className="mt-2 text-sm text-red-600">{fieldError}</p>
            ) : null}
          </div>
        );
      })}

      {connectedCount === ACCOUNT_DEFINITIONS.length ? (
        <p className="text-sm text-emerald-700">All accounts connected. Opening report…</p>
      ) : (
        <p className="text-sm text-zinc-600">
          Connect the remaining accounts one at a time whenever you have a fresh TOTP.
        </p>
      )}
    </div>
  );
}
