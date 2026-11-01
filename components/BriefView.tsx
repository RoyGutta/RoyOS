"use client";

import { useState } from "react";
import { usePolling, timeAgo } from "./usePolling";

interface Item { id: string; text: string; at: string | null; link: string | null }
interface Section { id: string; title: string; status: "ok" | "empty" | "covered" | "unavailable" | "error"; items: Item[]; more: number; alsoIn: string[]; note: string; checkedAt: string }
interface Brief { id: string; date: string; generatedAt: string; localTime: string; timezone: string; sections: Section[]; counts: Record<string, number>; summary: string }
interface Payload { brief: Brief | null; routine: { config: { enabled: boolean; timezone: string; time: string; channels: string[] }; state: { lastRunAt?: string; lastResult?: string; lastError?: string | null; by?: string }; nextRun: string; pendingToday: boolean; scheduling: string; userConfigFile: string } }

const STATUS_NOTE: Record<Section["status"], string> = { ok: "read", empty: "checked · nothing", covered: "shown above", unavailable: "not connected · not checked", error: "could not read" };

export default function BriefView() {
  const { data, refresh } = usePolling<Payload>("/api/brief", 15000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function generate() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate" }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false); setMsg(j.ok ? "Brief generated." : `Could not generate: ${j.error ?? r.status}`); refresh();
  }
  const b = data?.brief ?? null;
  const rt = data?.routine;
  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head">
          <span className="eyebrow">Daily brief</span>
          <span className="text-muted text-[11px]">{b ? `${b.date} · generated ${timeAgo(b.generatedAt)} (${b.timezone})` : "no brief yet"}</span>
          <span className="ml-auto flex items-center gap-2">{msg && <span className="text-[11px] text-muted" role="status">{msg}</span>}<button className="btn btn--primary btn--sm" onClick={() => void generate()} disabled={busy}>{busy ? "Generating…" : "Generate brief"}</button></span>
        </div>
        <div className="px-4 py-3 text-[12px] grid gap-2 md:grid-cols-2">
          <div>
            <div className="eyebrow mb-1">Schedule</div>
            {rt ? (
              <ul className="space-y-0.5">
                <li>{rt.config.enabled ? `Daily at ${rt.config.time} ${rt.config.timezone}` : "Disabled"} · channels: {rt.config.channels.join(", ")}</li>
                <li className="text-muted">{rt.scheduling}</li>
                <li>Next: {rt.nextRun}{rt.pendingToday ? (rt.state.lastError ? ` · today's slot is still pending (last run failed: ${rt.state.lastError})` : " · today's slot is still pending (it fires when the voice line is up and outside quiet hours)") : ""}</li>
                <li>Last run: {rt.state.lastRunAt ? `${rt.state.lastRunAt} by ${rt.state.by} · ${rt.state.lastResult}${rt.state.lastError ? ` (${rt.state.lastError})` : ""}` : "never"}</li>
                <li className="text-muted">Change it in {rt.userConfigFile} (timezone, time, channels, sources, maxItems, quietHours). Nothing is emailed or sent anywhere.</li>
              </ul>
            ) : <div className="text-muted">loading…</div>}
          </div>
          <div>
            <div className="eyebrow mb-1">Spoken summary</div>
            <div className="text-ink">{b?.summary ?? "—"}</div>
            {b && <div className="text-muted mt-1">{b.counts.ok} with items · {b.counts.empty} empty · {b.counts.unavailable} unavailable · {b.counts.error} errors</div>}
          </div>
        </div>
      </section>

      {b ? (
        <div className="grid gap-3 md:grid-cols-2">
          {b.sections.map((s) => (
            <section key={s.id} className={`brief-section brief-section--${s.status}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-ink text-[13px]">{s.title}</span>
                <span className={`badge ${s.status === "ok" ? "badge--ok" : s.status === "error" ? "badge--bad" : s.status === "unavailable" ? "badge--warn" : ""}`}>{STATUS_NOTE[s.status]}</span>
              </div>
              <div className="text-muted text-[11px] mb-1">{s.note}</div>
              {s.items.length > 0 ? (
                <ul className="space-y-1 text-[12px]">
                  {s.items.map((it) => <li key={it.id} className="flex gap-2"><span className="text-ink">{it.text}</span>{it.at && <span className="text-muted shrink-0">{it.at.slice(5, 16).replace("T", " ")}</span>}{it.link && <a className="text-accent shrink-0" href={it.link}>open</a>}</li>)}
                  {s.more > 0 && <li className="text-muted">… {s.more} more</li>}
                </ul>
              ) : s.alsoIn.length > 0 ? <div className="text-muted text-[12px]">items already listed under {s.alsoIn.join(", ")}</div> : null}
            </section>
          ))}
        </div>
      ) : (
        <section className="panel"><div className="px-4 py-3 text-[12px] text-muted">No brief has been generated. Press “Generate brief”, say “give me my daily brief”, or run <code>uv run python brief.py</code> in voice-line.</div></section>
      )}
    </div>
  );
}
