"use client";

import { useEffect, useRef, useState } from "react";
import { usePolling } from "./usePolling";
import { askJarvis } from "./CommandBar";
import Orb, { moodFor } from "./Orb";
import type { JarvisPayload } from "@/app/api/jarvis/route";
import { STATE_LABEL, type Turn } from "@/lib/jarvis/events";
import type { AgentInfo, Task } from "@/lib/jarvis/types";

interface AudioPayload { speaking: { live: boolean; level: number; samples: number[] }; mic: { live: boolean; level: number; samples: number[] } }
interface AgentsPayload { agents: AgentInfo[]; open: Task[]; schedulerAlive: boolean }
interface SystemPayload { services: { name: string; up: boolean; required: boolean }[]; voice: { engineOrder: string } }

const hhmmss = (d: Date) => d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const TURN_BADGE: Record<string, string> = { open: "live", COMPLETED: "done", FAILED: "failed", CANCELLED: "cancelled", TIMED_OUT: "timed out", WAITING_FOR_APPROVAL: "needs approval", RUNNING: "running", QUEUED: "queued" };

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return <span className="hud-clock"><span className="sr-only">local time </span>{now ? hhmmss(now) : "--:--:--"}</span>;
}

function TurnCard({ t, isLast, running }: { t: Turn; isLast: boolean; running: boolean }) {
  const failed = ["FAILED", "TIMED_OUT"].includes(t.state) || !!t.error;
  const stale = t.state === "open" && !running;   // the runtime stopped before this turn closed
  return (
    <li className={`turn ${isLast ? "turn--last" : ""}`}>
      <div className="turn__you"><span className="turn__who" title={`from ${t.source}`}>You<br /><span className="normal-case tracking-normal">{t.source}</span></span><span className="turn__text">{t.you || "…"}</span></div>
      <div className="turn__jarvis">
        <span className="turn__who">Jarvis{t.interrupted ? " · interrupted" : ""}</span>
        <span className="turn__text">{t.jarvis || (t.state === "open" ? <span className="text-muted">working…</span> : <span className="text-muted">(no spoken reply)</span>)}</span>
        {t.error && <span className="turn__error">{t.error}</span>}
      </div>
      <div className="turn__meta">
        <span className={`badge ${t.approval?.resolved === false ? "badge--warn" : t.state === "COMPLETED" ? "badge--ok" : failed ? "badge--bad" : t.state === "open" ? "badge--accent" : t.state === "WAITING_FOR_APPROVAL" ? "badge--warn" : ""}`}>{stale ? "interrupted (runtime stopped)" : t.approval?.resolved === false ? "declined" : t.approval?.resolved === true ? `approved · ${TURN_BADGE[t.state] ?? t.state}` : TURN_BADGE[t.state] ?? t.state}</span>
        <span className="text-muted">{clock(t.ts)}</span>
        {t.tools.length > 0 && (
          <details className="turn__tools">
            <summary>{t.tools.length} tool call{t.tools.length === 1 ? "" : "s"}{t.tools.some((x) => x.ok === false) ? " · a tool failed" : ""}</summary>
            <ol>
              {t.tools.map((x) => <li key={x.id} className={x.ok === false ? "text-offline" : x.ok === null ? "text-warn" : ""}>{x.summary || x.name.replace("mcp__jarvis__", "")} <span className="text-muted">· {x.ok === null ? "running" : x.ok ? "ok" : "failed"}</span></li>)}
            </ol>
          </details>
        )}
        {t.runId && <a className="text-muted" href="/runs">{t.runId}</a>}
      </div>
    </li>
  );
}

export default function Assistant() {
  const j = usePolling<JarvisPayload>("/api/jarvis", 1200);
  const ag = usePolling<AgentsPayload>("/api/agents", 4000);
  const sys = usePolling<SystemPayload>("/api/system", 15000);
  const data = j.data;
  const running = data?.running ?? false;
  const state = data?.state ?? "OFFLINE";
  const busy = running && !["IDLE", "WAITING_FOR_APPROVAL", "ERROR"].includes(state);
  const wantsAudio = running && ["SPEAKING", "LISTENING", "TRANSCRIBING"].includes(state);
  const audio = usePolling<AudioPayload>("/api/jarvis/audio", wantsAudio ? 120 : 60_000);
  const pending = data?.pendingApproval ?? null;
  const justFinished = data?.lastFinished && Date.now() / 1000 - data.lastFinished.ts < 4 ? data.lastFinished.state : null;
  const mood = moodFor(state, justFinished);
  const sig = state === "LISTENING" ? audio.data?.mic : audio.data?.speaking;
  const live = wantsAudio && !!sig?.live;
  const level = live ? sig!.level : 0;

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [motionOff, setMotionOff] = useState(false);
  useEffect(() => { try { setMotionOff(localStorage.getItem("jarvis.motion") === "off"); } catch { /* storage unavailable */ } }, []);
  const toggleMotion = () => { const next = !motionOff; setMotionOff(next); try { localStorage.setItem("jarvis.motion", next ? "off" : "on"); } catch { /* ignore */ } };
  const [deciding, setDeciding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const turns = data?.turns ?? [];
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [turns.length, data?.lastJarvis]);
  useEffect(() => { setNote(null); }, [turns.length]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const r = await askJarvis({ text: t });
    setSending(false);
    setNote(r.ok ? { ok: true, text: "Sent to the runtime." } : { ok: false, text: r.error ?? "failed" });
    if (r.ok) setText("");
    inputRef.current?.focus();
  }
  async function stop() {
    const r = await askJarvis({ kind: "cancel" });
    setNote(r.ok ? { ok: true, text: "Stop sent: playback and the current turn are interrupted." } : { ok: false, text: r.error ?? "failed" });
  }
  async function decide(kind: "approve" | "decline") {
    if (!pending?.id) { setNote({ ok: false, text: "This approval has no id; answer Jarvis by voice." }); return; }
    if (deciding) return;
    setDeciding(true);
    const r = await askJarvis({ kind, approvalId: pending.id });
    setDeciding(false);
    setNote(r.ok ? { ok: true, text: kind === "approve" ? `Approved ${pending.id} — that one action only.` : "Declined." } : { ok: false, text: r.error ?? "failed" });
    inputRef.current?.focus();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && busy) { e.preventDefault(); void stop(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const caption = !running ? "Voice line offline — start-jarvis.command, then ask here." : STATE_LABEL[state] ?? state;
  const detail = data?.detail || (state === "IDLE" ? "Hold Right Option and speak, or type below." : "");
  const stale = running && busy && (data?.statusAgeSeconds ?? 0) > 30;
  const openTasks = ag.data?.open ?? [];
  const current = data?.currentRun ?? null;
  const down = sys.data?.services.filter((s) => s.required && !s.up) ?? [];

  return (
    <div className="hud" data-mood={mood} data-motion={motionOff ? "off" : "on"}>
      <div className="hud__top">
        <div className="hud__title"><span className="hud__wordmark">JARVIS</span><span className="hud__sub">personal assistant · one runtime</span></div>
        <div className="sr-only" role="status" aria-live="assertive">{pending ? `Approval requested: ${pending.description}` : ""}</div>
        <div className={`hud__state hud__state--${mood}`} role="status" aria-live="polite">
          <span className="hud__dot" aria-hidden /> {caption}{stale ? <span aria-hidden="true">{` · no update for ${data?.statusAgeSeconds}s`}</span> : null}
        </div>
        <div className="hud__right"><span className="text-muted">{data?.resumed ? "conversation resumed · " : ""}brain Claude (subscription)</span><button type="button" className="btn btn--sm" onClick={toggleMotion} aria-pressed={motionOff}>{motionOff ? "Resume motion" : "Pause motion"}</button> <Clock /></div>
      </div>

      <div className="hud__grid">
        <aside className="hud__side hud__side--left" aria-label="Session readouts">
          <div className="hud__panel">
            <div className="eyebrow">Session</div>
            <dl className="hud__dl">
              <dt>Runtime</dt><dd className={running ? "text-online" : "text-offline"}>{running ? "voice line up" : "offline"}</dd>
              <dt>Voice</dt><dd>{sys.data?.voice.engineOrder ?? "—"}</dd>
              <dt>Mic</dt><dd>{state === "LISTENING" ? (audio.data?.mic.live ? "open · live level" : "open") : "closed (hold-to-talk)"}</dd>
              <dt>Runs</dt><dd>{data?.runs.total ?? 0} total · {data?.runs.byState.COMPLETED ?? 0} done · {data?.runs.byState.FAILED ?? 0} failed</dd>
              <dt>Update</dt><dd>{data?.statusAgeSeconds == null ? "—" : `${data.statusAgeSeconds}s ago`}</dd>
              {down.length > 0 && <><dt className="text-offline">Down</dt><dd className="text-offline">{down.map((d) => d.name).join(", ")} · <a href="/system">system</a></dd></>}
            </dl>
          </div>
          <div className="hud__panel">
            <div className="eyebrow">Controls</div>
            <ul className="hud__keys">
              <li><kbd>Right Option</kbd> hold to talk · press to interrupt</li>
              <li><kbd>Enter</kbd> send text · <kbd>Esc</kbd> stop</li>
              <li><a href="/brief">Daily brief</a> · <a href="/command">Command center</a></li>
            </ul>
          </div>
          <div className="hud__panel">
            <div className="eyebrow">Activity</div>
            {data && data.activity.length > 0 ? (
              <ul className="hud__activity">{[...data.activity].reverse().slice(0, 8).map((a, i) => <li key={`${a.ts}-${i}`}><span className="text-muted">{clock(a.ts)}</span> {a.summary}</li>)}</ul>
            ) : <div className="text-muted">nothing yet this session</div>}
          </div>
        </aside>

        <section className="hud__center" aria-label="Conversation">
          <div className="hud__orbwrap">
            <Orb mood={mood} level={level} live={live} samples={sig?.samples} />
            <div className="hud__caption">
              <div className={`hud__caption-state hud__caption-state--${mood}`}>{caption}</div>
              {detail && <div className="hud__caption-detail">{detail}</div>}
              {justFinished && <div className="hud__caption-detail">last request {justFinished.toLowerCase().replace(/_/g, " ")}</div>}
            </div>
          </div>

          <ol className="hud__turns" ref={listRef} aria-label="Transcript" role="log" aria-live="polite" tabIndex={0}>
            {turns.length === 0 && <li className="text-muted hud__empty">{running ? "No turns yet this session. Say something or type below." : "Transcript appears here once the voice line is running. Past runs: /runs."}</li>}
            {turns.map((t, i) => <TurnCard key={t.seq} t={t} isLast={i === turns.length - 1} running={running} />)}
          </ol>

          <form className="hud__input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input ref={inputRef} className="input hud__field" value={text} onChange={(e) => setText(e.target.value)} disabled={sending}
              aria-label="Message for Jarvis" placeholder={running ? "Type to Jarvis… (same runtime as voice)" : "Voice line offline — start it, then type here"} />
            <button type="submit" className="btn btn--primary" disabled={sending || !text.trim()}>{sending ? "Sending…" : "Send"}</button>
            <button type="button" className="btn btn--danger" onClick={() => void stop()} disabled={!busy && !pending} aria-label="Stop speaking and cancel the current task">Stop</button>
          </form>
          <div className={`hud__note ${note ? (note.ok ? "text-online" : "text-offline") : ""}`} role="status" aria-live="polite">{note && <>{note.text}{!note.ok && !running ? <> · <a href="/system">how to start</a></> : null}</>}</div>
        </section>

        <aside className="hud__side hud__side--right" aria-label="Task and approval details">
          {pending && (
            <div className="hud__panel hud__panel--approval" role="region" aria-label="Approval requested" aria-busy={deciding}>
              <div className="eyebrow text-warn">Needs your approval</div>
              <div className="hud__approval-action">{pending.description}</div>
              <dl className="hud__dl">
                {pending.category && <><dt>Category</dt><dd>{pending.category}</dd></>}
                {pending.target && <><dt>Target</dt><dd className="break-all">{pending.target}</dd></>}
                {pending.effect && <><dt>Effect</dt><dd>{pending.effect}</dd></>}
                {pending.cost && <><dt>Cost</dt><dd>{pending.cost}</dd></>}
                <dt>Reversible</dt><dd>{pending.reversible === true ? "yes" : pending.reversible === false ? "no" : "unknown"}</dd>
                <dt>Bound to</dt><dd>{pending.id ?? "this action"}</dd>
              </dl>
              <div className="flex gap-2 mt-2">
                <button className="btn btn--primary" onClick={() => void decide("approve")} disabled={deciding}>Approve this action</button>
                <button className="btn" onClick={() => void decide("decline")} disabled={deciding}>Decline</button>
              </div>
            </div>
          )}
          <div className="hud__panel">
            <div className="eyebrow">Current task</div>
            {current ? (
              <div>
                <div className="hud__task-req">{current.request}</div>
                <div className="text-muted">{current.id} · {current.state.toLowerCase().replace(/_/g, " ")} · from {current.source}</div>
                {current.tools.length > 0 ? (
                  <ol className="timeline mt-2">
                    {current.tools.slice(-5).map((x) => (
                      <li key={x.id} className={`timeline__item ${x.ok === true ? "timeline__item--ok" : x.ok === false ? "timeline__item--bad" : "timeline__item--live"}`}>
                        <div className="truncate">{x.summary || x.name.replace("mcp__jarvis__", "")}</div>
                        <div className="text-muted">{x.ok === null ? "running" : x.ok ? "ok" : "failed"}</div>
                      </li>
                    ))}
                  </ol>
                ) : <div className="text-muted mt-1">no tool calls yet</div>}
                <details className="mt-2 hud__details"><summary>Details</summary><pre className="hud__pre" tabIndex={0} aria-label="Turn details">{JSON.stringify({ id: current.id, state: current.state, detail: current.detail, toolCalls: current.toolCalls, toolFailures: current.toolFailures, approval: current.approval, error: current.error, verification: current.verification }, null, 1)}</pre></details>
              </div>
            ) : <div className="text-muted">{running ? "nothing running" : "runtime offline"}</div>}
          </div>
          <div className="hud__panel">
            <div className="eyebrow">Agents</div>
            {openTasks.length > 0 ? (
              <ul className="hud__agents">
                {openTasks.slice(0, 6).map((t) => (
                  <li key={t.id}><span className="hud__agent-name">{t.agent}</span> <span className="text-ink">{t.title || t.request.slice(0, 60)}</span> <span className={`badge ${t.state === "RUNNING" ? "badge--accent" : t.state === "WAITING_FOR_APPROVAL" ? "badge--warn" : ""}`}>{t.state.toLowerCase().replace(/_/g, " ")}</span></li>
                ))}
              </ul>
            ) : <div className="text-muted">no delegated tasks open{ag.data && !ag.data.schedulerAlive ? " · scheduler idle" : ""}</div>}
            <div className="mt-1"><a href="/agents" className="text-accent">agent center</a> · <a href="/integrations" className="text-accent">integrations</a></div>
          </div>
          {(data?.errors.length ?? 0) > 0 && (
            <div className="hud__panel">
              <div className="eyebrow text-offline">Errors</div>
              <ul className="hud__activity">{data!.errors.slice(-4).reverse().map((e, i) => <li key={i} className="text-offline"><span className="text-muted">{clock(e.ts)}</span> {e.where}: {e.message}</li>)}</ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
