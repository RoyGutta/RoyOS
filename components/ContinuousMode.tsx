"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling } from "./usePolling";
import { displayLabel, fmtAge, fmtTime, reasonText, toggleState, type StatusPayload } from "@/lib/continuous/view";

type Verb = "on" | "off" | "pause" | "resume" | "stop";
interface LastCommand { verb: Verb; ok: boolean; message: string; at: number }

/**
 * Continuous Mode panel. Every value is the Mac's own report (polled every 5 s): the switch mirrors `enabled` + `display`,
 * never local UI state, and shows UNKNOWN whenever the report is older than 60 s or missing. All text is rendered as
 * text. Controls are real buttons (keyboard-operable, visible focus from globals.css) and state changes are announced.
 */
export default function ContinuousMode({ embedded = false }: { embedded?: boolean }) {
  const { data, error, refresh } = usePolling<StatusPayload>("/api/continuous/status", 5000);
  const [busy, setBusy] = useState<Verb | null>(null);
  const [last, setLast] = useState<LastCommand | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [announce, setAnnounce] = useState("");
  const prev = useRef("");

  const online = data?.online ?? false;
  const snap = data?.snapshot ?? null;
  const sv = snap?.supervisor ?? null;
  const toggle = toggleState(online, snap);

  useEffect(() => {
    const key = `${toggle}:${sv?.display ?? "none"}`;
    if (prev.current && prev.current !== key) setAnnounce(toggle === "unknown" ? "Continuous mode state unknown: the Mac is offline" : `Continuous mode ${toggle}, ${displayLabel(sv?.display)}`);
    prev.current = key;
  }, [toggle, sv?.display]);

  const send = useCallback(async (verb: Verb) => {
    if (!data?.csrf || busy) return;
    setBusy(verb);
    setConfirmStop(false);
    try {
      const res = await fetch("/api/continuous/command", { method: "POST", headers: { "content-type": "application/json", "x-csrf": data.csrf }, body: JSON.stringify({ verb }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      const ok = res.ok && j.ok !== false;
      const message = typeof j.message === "string" ? j.message : typeof j.error === "string" ? j.error : ok ? "accepted" : `HTTP ${res.status}`;
      setLast({ verb, ok, message, at: Date.now() });
      setAnnounce(`${verb}: ${ok ? "accepted" : "refused"}. ${message}`);
    } catch {
      setLast({ verb, ok: false, message: "request failed", at: Date.now() });
      setAnnounce(`${verb}: request failed`);
    } finally {
      setBusy(null);
      refresh();
    }
  }, [data?.csrf, busy, refresh]);

  if (error === "HTTP 401") {
    return (
      <section className="panel">
        <Head mode={null} />
        <div className="px-4 py-3 text-[13px] flex items-center gap-3"><span className="text-dim">Sign in to see and control Continuous Mode.</span><a className="btn btn--primary" href={embedded ? "/login?next=/system" : "/login?next=/continuous"}>Sign in</a></div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="panel">
        <Head mode={null} />
        <div className="px-4 py-3 text-[13px] text-offline" role="alert">Status unavailable: {error}{error === "HTTP 503" ? " — the dashboard cannot reach its keys or its durable store (details on the sign-in page)." : ""}</div>
      </section>
    );
  }
  if (!data) return <section className="panel"><Head mode={null} /><div className="px-4 py-3 text-muted text-[13px]">Loading…</div></section>;

  const loaded = sv?.launchAgentLoaded === true;
  const canAct = online && !!sv && !busy && data.installed;
  const lastShown: LastCommand | { verb: string; ok: boolean | null; message: string | null; at: number | null } | null =
    last ?? (data.recent[0] ? { verb: data.recent[0].verb, ok: data.recent[0].ok, message: data.recent[0].message ?? data.recent[0].status, at: data.recent[0].ackedAt ? Date.parse(data.recent[0].ackedAt) : null } : null);

  return (
    <section className="panel flex flex-col" aria-labelledby="cm-title">
      <Head mode={data.mode} />
      <div className={`carrier ${online && toggle === "on" && sv?.display === "running" ? "carrier--live" : ""}`} aria-hidden="true" />
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {/* availability banner */}
      {!online && (
        <div className="px-4 pt-3" role="status">
          <span className="badge badge--bad">{data.receivedAt ? `OFFLINE — last seen ${fmtAge(data.ageSec)}` : "UNKNOWN — no report from the Mac yet"}</span>
          {data.mode === "hosted" && <span className="text-muted text-[11px] ml-2">the Mac reports every 15 s while com.jarvis.link is loaded</span>}
        </div>
      )}
      {data.mode === "local" && !data.installed && <div className="px-4 pt-3 text-offline text-[12px]" role="alert">{data.error ?? "Mac-side link not installed (run supervisor.py install)"}</div>}
      {data.mode === "local" && data.installed && data.error && <div className="px-4 pt-3 text-offline text-[12px]" role="alert">{data.error}</div>}

      {/* switch + controls */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-4">
        <button
          type="button" role="switch" id="cm-switch" aria-checked={toggle === "on"} aria-describedby="cm-state"
          disabled={!canAct || toggle === "unknown" || (toggle === "off" && !loaded)}
          onClick={() => (toggle === "on" ? send("off") : toggle === "off" ? send("on") : undefined)}
          className={`relative inline-flex items-center h-9 w-[84px] rounded-full border transition-colors disabled:cursor-not-allowed ${toggle === "on" ? "bg-accent/20 border-accent" : toggle === "off" ? "bg-black/30 border-line2" : "bg-black/20 border-dashed border-line2 opacity-70"}`}
        >
          <span aria-hidden="true" className={`absolute top-1 h-7 w-7 rounded-full transition-all ${toggle === "on" ? "left-[52px] bg-accent" : toggle === "off" ? "left-1 bg-dim" : "left-[26px] bg-muted"}`} />
          <span className="sr-only">Continuous mode</span>
        </button>
        <div className="flex flex-col">
          <span id="cm-state" className={`text-[15px] tracking-[0.14em] uppercase ${toggle === "on" ? "text-accent" : toggle === "unknown" ? "text-muted" : "text-ink"}`}>{toggle === "unknown" ? "Unknown" : toggle}</span>
          <span className="text-dim text-[12px]">{sv ? displayLabel(sv.display) : "no snapshot"}{sv?.reason && reasonText(sv.reason) ? ` · ${reasonText(sv.reason)}` : ""}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto" role="group" aria-label="Continuous mode actions">
          <button type="button" className="btn" disabled={!canAct || toggle !== "on" || sv?.paused === true} onClick={() => send("pause")} aria-busy={busy === "pause"}>Pause</button>
          <button type="button" className="btn" disabled={!canAct || toggle !== "on" || sv?.paused !== true} onClick={() => send("resume")} aria-busy={busy === "resume"}>Resume</button>
          {!confirmStop ? (
            <button type="button" className="btn btn--danger" disabled={!canAct || toggle === "unknown"} onClick={() => setConfirmStop(true)}>Stop now</button>
          ) : (
            <span className="inline-flex items-center gap-2" role="group" aria-label="Confirm stop">
              <button type="button" className="btn btn--danger" disabled={!canAct} onClick={() => send("stop")} aria-busy={busy === "stop"} autoFocus>Confirm: interrupt the running session</button>
              <button type="button" className="btn btn--sm" onClick={() => setConfirmStop(false)}>Cancel</button>
            </span>
          )}
        </div>
      </div>
      {sv && !loaded && <div className="px-4 pb-2 text-warn text-[12px]" role="status">The supervisor LaunchAgent is not loaded. Run <code>supervisor.py start</code> in Terminal once; the browser cannot load it.</div>}

      {/* pending + last command */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-3 text-[12px]">
        {busy && <span className="badge badge--accent" role="status">sending {busy}…</span>}
        {data.pending.length > 0 && <span className="badge badge--warn" role="status">{data.pending.length} command{data.pending.length === 1 ? "" : "s"} waiting for the Mac: {data.pending.map((p) => p.verb).join(", ")}</span>}
        {lastShown && (
          <span className="text-dim">Last command: <span className="text-ink">{lastShown.verb}</span> · <span className={lastShown.ok === true ? "text-online" : lastShown.ok === false ? "text-offline" : "text-muted"}>{lastShown.ok === true ? "ok" : lastShown.ok === false ? "refused" : "pending"}</span>{lastShown.message ? ` · ${lastShown.message}` : ""}{lastShown.at ? ` · ${fmtAge((Date.now() - lastShown.at) / 1000)}` : ""}</span>
        )}
      </div>

      {/* facts grid */}
      {sv && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 px-4 pb-4 text-[12.5px] border-t border-line pt-3">
          <Fact label="Model">{sv.model ? `${sv.model.requested}${sv.model.requestedId && sv.model.requestedId !== sv.model.requested ? ` (${sv.model.requestedId})` : ""} → ${sv.model.actual ?? "not reported"}` : "idle"}</Fact>
          <Fact label="Effort">{sv.model?.effort ?? "—"}</Fact>
          <Fact label="Runs today">{`${sv.runsToday} / ${sv.maxRunsPerDay}`}</Fact>
          <Fact label="Current task">{sv.currentTask ?? (sv.taskSource === "checkpoint" ? "from the checkpoint" : "—")}</Fact>
          <Fact label="Next task">{sv.nextTask ?? "—"}</Fact>
          <Fact label="Next check">{fmtTime(sv.nextCheckAt)}</Fact>
          <Fact label="Last run">{sv.lastRun ? `${sv.lastRun.outcome} · ${sv.lastRun.model} (${sv.lastRun.effort ?? "?"}) ran ${sv.lastRun.actualModel ?? "?"} · ended ${fmtTime(sv.lastRun.endedAt)} · ${sv.lastRun.patchFiles} patch file${sv.lastRun.patchFiles === 1 ? "" : "s"}${sv.lastRun.objective ? ` · ${sv.lastRun.objective}` : ""}` : "none yet"}</Fact>
          <Fact label="Usage">{`${sv.usage.status}${sv.usage.resetAt ? ` · resets ${fmtTime(sv.usage.resetAt)}` : ""}${Object.keys(sv.usage.modelBlocks).length ? ` · blocked: ${Object.entries(sv.usage.modelBlocks).map(([m, b]) => `${m} until ${fmtTime(b.until)} (${reasonText(b.reason)})`).join("; ")}` : ""}`}</Fact>
          <Fact label="Reported">{`${fmtTime(snap?.at)} · seq ${snap?.seq ?? "—"} · ${data.mode === "hosted" ? "via relay" : "local"} · flags: ${[sv.enabled ? "enabled" : "disabled", loaded ? "agent loaded" : "agent not loaded", sv.paused ? "paused" : null, sv.stopped ? "stopped" : null].filter(Boolean).join(", ")}`}</Fact>
        </dl>
      )}
    </section>
  );
}

function Head({ mode }: { mode: "local" | "hosted" | null }) {
  return (
    <div className="panel__head">
      <span className="eyebrow" id="cm-title">Continuous mode</span>
      <span className="text-muted text-[11px]">{mode === "hosted" ? "hosted · the Mac reports every 15 s" : mode === "local" ? "local · supervisor.py link-status every 5 s" : ""}</span>
      <a className="nav__link ml-auto" href="/continuous">Open</a>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-ink break-words">{children}</dd>
    </div>
  );
}
