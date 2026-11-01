"use client";

import { useState, type FormEvent } from "react";

interface Props { hosted: boolean; next: string; problem: string | null }

/** Passphrase (+ TOTP when hosted). Errors are plain text in a live region; the browser adds Origin and Sec-Fetch-Site. */
export default function LoginForm({ hosted, next, problem }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hosted ? { passphrase, code } : { passphrase }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) { window.location.assign(next); return; }
      setError(typeof j.error === "string" ? j.error : `sign-in failed (HTTP ${res.status})`);
      setPassphrase("");
      setCode("");
    } catch {
      setError("sign-in request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-describedby={problem ? "login-problem" : undefined}>
      {problem && <p id="login-problem" role="alert" className="text-offline text-[12px]">{problem}</p>}
      <label className="flex flex-col gap-1 text-[12px] text-dim">
        <span>Passphrase</span>
        <input className="input" type="password" name="passphrase" autoComplete="current-password" required minLength={1} maxLength={1024} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={busy || !!problem} autoFocus />
      </label>
      {hosted && (
        <label className="flex flex-col gap-1 text-[12px] text-dim">
          <span>Authenticator code</span>
          <input className="input" type="text" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy || !!problem} aria-describedby="code-hint" />
          <span id="code-hint" className="text-muted text-[11px]">6 digits from the app enrolled by supervisor.py dashboard-passcode</span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn--primary" disabled={busy || !!problem} aria-busy={busy}>{busy ? "Checking…" : "Sign in"}</button>
        <span role="status" aria-live="polite" className="text-offline text-[12px]">{error ?? ""}</span>
      </div>
      <p className="text-muted text-[11px]">5 failed attempts lock sign-in for 15 minutes. Sessions last at most 12 hours.</p>
    </form>
  );
}
