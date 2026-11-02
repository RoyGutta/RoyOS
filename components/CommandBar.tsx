"use client";

import { useState } from "react";
import { approvalHeaders } from "./useApprovalSession";

export type AskResult = { ok: boolean; error?: string };

/** A command for the voice line. An approve/decline must carry the session-bound X-CSRF (useApprovalSession); the server
 *  refuses it otherwise (G9-2). Plain asks and cancels carry none. */
export async function askJarvis(body: Record<string, unknown>, csrf?: string | null): Promise<AskResult> {
  try {
    const r = await fetch("/api/jarvis/ask", { method: "POST", headers: approvalHeaders(csrf), body: JSON.stringify(body) });
    return (await r.json()) as AskResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

/**
 * The one command field. Text goes to the SAME runtime the voice uses (the
 * voice line's inbox → typed handler → Claude with Jarvis's tools). Voice is
 * hold-to-talk on the Mac (Right Option by default); this bar is the typed
 * twin, not a second assistant.
 */
export default function CommandBar({ running, busy, initial = "", compact = false, onSent }: { running: boolean; busy: boolean; initial?: string; compact?: boolean; onSent?: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const r = await askJarvis({ text: t });
    setSending(false);
    if (r.ok) {
      setMsg({ kind: "ok", text: "Sent — Jarvis is on it." });
      setText("");
      onSent?.(t);
    } else {
      setMsg({ kind: "err", text: r.error ?? "failed" });
    }
  }

  async function cancel() {
    const r = await askJarvis({ kind: "cancel" });
    setMsg(r.ok ? { kind: "ok", text: "Cancel sent." } : { kind: "err", text: r.error ?? "failed" });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={running ? "Ask Jarvis… e.g. find ten potential website clients in Tampa" : "Voice line offline — start-jarvis.command, then ask here"}
          aria-label="Command for Jarvis"
          className="input"
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !text.trim()} className="btn btn--primary">{sending ? "Sending…" : "Send"}</button>
        {busy && <button onClick={cancel} className="btn btn--danger" title="Interrupt the current turn">Stop</button>}
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>Voice: hold <kbd className="chip">Right Option</kbd> at the Mac and speak; press it again to interrupt.</span>
          {msg && <span className={msg.kind === "ok" ? "text-online" : "text-offline"} role="status">{msg.text}{msg.kind === "err" && !running && <> · <a className="text-accent" href="/system">how to start</a></>}</span>}
        </div>
      )}
      {compact && msg && <div className={`text-[11px] ${msg.kind === "ok" ? "text-online" : "text-offline"}`} role="status">{msg.text}</div>}
    </div>
  );
}
