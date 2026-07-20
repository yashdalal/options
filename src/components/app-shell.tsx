"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginForm } from "@/components/login-form";
import { MonitorDashboard } from "@/components/monitor-dashboard";

type AuthStatus = {
  authenticated: boolean;
  status: string;
  highlightDefault: number;
  configured?: boolean;
};

export function AppShell() {
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex w-full max-w-md flex-col gap-3">
          {auth?.configured === false ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Copy `.env.example` to `.env.local` and fill in Kotak credentials before signing in.
            </div>
          ) : null}
          <LoginForm onAuthenticated={() => void loadStatus()} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <MonitorDashboard
        highlightDefault={auth.highlightDefault}
        onLogout={() => void loadStatus()}
        onLoginRequired={() => void loadStatus()}
      />
    </div>
  );
}
