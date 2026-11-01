"use client";

import { useState } from "react";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (res.ok) { window.location.assign("/login"); return; }
      setError(`sign-out failed (HTTP ${res.status})`);
    } catch { setError("sign-out request failed"); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="btn" onClick={signOut} disabled={busy} aria-busy={busy}>{busy ? "Signing out…" : "Sign out"}</button>
      <span role="status" aria-live="polite" className="text-offline text-[12px]">{error ?? ""}</span>
    </div>
  );
}
