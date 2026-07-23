"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LoginForm,
  type AccountAuthStatus,
} from "@/components/login-form";
import { InvestmentReport } from "@/components/investment-report";
import { MonitorDashboard } from "@/components/monitor-dashboard";
import { OptionsScreener } from "@/components/options-screener";
import { ACCOUNT_DEFINITIONS } from "@/config/accounts";

type AuthStatus = {
  authenticated: boolean;
  status: string;
  highlightDefault: number;
  configured?: boolean;
  accounts?: AccountAuthStatus[];
};

type AppTab = "monitor" | "screener" | "report";

const EMPTY_ACCOUNTS: AccountAuthStatus[] = ACCOUNT_DEFINITIONS.map((definition) => ({
  accountId: definition.id,
  label: definition.label,
  status: "disconnected" as const,
}));

export function AppShell() {
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AppTab>("monitor");

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      if (!response.ok) {
        setError("Unable to load authentication status. Check server environment variables.");
        setAuth(null);
        return;
      }
      const payload = (await response.json()) as AuthStatus;
      setAuth(payload);
      setError(null);
    } catch {
      setError("Unable to reach the local server.");
      setAuth(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // Initial remote auth status fetch for the local dashboard shell.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount fetch
    void loadStatus();
  }, [loadStatus]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 text-sm text-zinc-600">
        Loading…
      </div>
    );
  }

  if (error && !auth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!auth?.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
        <div className="flex w-full max-w-lg flex-col gap-3">
          {auth?.configured === false ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Copy `.env.example` to `.env.local` and fill in credentials for Prakash, Gopa, and
              HUF before connecting.
            </div>
          ) : null}
          {auth?.status === "expired" || auth?.status === "partial" ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              All three accounts must be connected before the report is available. Connected
              accounts are kept; reconnect only the accounts that still need a TOTP.
            </div>
          ) : null}
          <LoginForm
            accounts={auth?.accounts ?? EMPTY_ACCOUNTS}
            onStatusChange={() => void loadStatus()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-0 px-4 pt-4 sm:px-6">
        <div
          className="flex gap-2"
          role="tablist"
          aria-label="Application views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "monitor"}
            onClick={() => setTab("monitor")}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === "monitor"
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
            }`}
          >
            Near Expiry
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "screener"}
            onClick={() => setTab("screener")}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === "screener"
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
            }`}
          >
            Screener
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "report"}
            onClick={() => setTab("report")}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === "report"
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50"
            }`}
          >
            Investment Report
          </button>
        </div>
      </div>
      <div className={tab === "monitor" ? undefined : "hidden"}>
        <MonitorDashboard
          active={tab === "monitor"}
          highlightDefault={auth.highlightDefault}
          onLogout={() => void loadStatus()}
          onLoginRequired={() => void loadStatus()}
        />
      </div>
      <div className={tab === "screener" ? undefined : "hidden"}>
        <OptionsScreener
          onLogout={() => void loadStatus()}
          onLoginRequired={() => void loadStatus()}
        />
      </div>
      <div className={tab === "report" ? undefined : "hidden"}>
        <InvestmentReport
          onLogout={() => void loadStatus()}
          onLoginRequired={() => void loadStatus()}
        />
      </div>
    </div>
  );
}
