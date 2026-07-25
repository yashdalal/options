"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LoginForm,
  type AccountAuthStatus,
} from "@/components/login-form";
import { InvestmentReport } from "@/components/investment-report";
import { MonitorDashboard } from "@/components/monitor-dashboard";
import { ACCOUNT_DEFINITIONS } from "@/config/accounts";

type AuthStatus = {
  authenticated: boolean;
  status: string;
  highlightDefault: number;
  configured?: boolean;
  accounts?: AccountAuthStatus[];
};

type AppTab = "monitor" | "report";

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadStatus();
  }

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

  const navItems: { id: AppTab; label: string }[] = [
    { id: "monitor", label: "Near Expiry" },
    { id: "report", label: "Investment Report" },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-100">
      <header className="shrink-0 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-12 w-full max-w-7xl items-stretch justify-between gap-6 px-4 sm:px-6">
          <nav
            className="flex min-w-0 items-stretch gap-6"
            role="tablist"
            aria-label="Application views"
          >
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={`relative text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "text-zinc-900"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {item.label}
                  {active ? (
                    <span
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-900"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => void logout()}
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      <div
        className={`min-h-0 flex-1 overflow-y-auto ${tab === "monitor" ? undefined : "hidden"}`}
      >
        <MonitorDashboard
          active={tab === "monitor"}
          highlightDefault={auth.highlightDefault}
          onLoginRequired={() => void loadStatus()}
        />
      </div>
      <div
        className={`flex min-h-0 flex-1 flex-col ${tab === "report" ? undefined : "hidden"}`}
      >
        <InvestmentReport onLoginRequired={() => void loadStatus()} />
      </div>
    </div>
  );
}
