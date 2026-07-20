"use client";

import { FormEvent, useState } from "react";

type LoginFormProps = {
  onAuthenticated: () => void;
};

export function LoginForm({ onAuthenticated }: LoginFormProps) {
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Authentication failed");
        return;
      }
      setTotp("");
      onAuthenticated();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Near Expiry Monitor</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Enter the current 6-digit TOTP from your authenticator app. API token, UCC, mobile, and
          MPIN stay on the server.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800">
        TOTP
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={totp}
          onChange={(event) => setTotp(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base tracking-[0.3em] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          placeholder="123456"
          required
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || totp.length !== 6}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
