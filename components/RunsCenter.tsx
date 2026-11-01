"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";
import { askJarvis } from "./CommandBar";
import { RUN_SOURCES, RUN_STATES, type Run } from "@/lib/jarvis/types";
import type { JarvisPayload } from "@/app/api/jarvis/route";

interface RunsPayload { summary: { total: number; byState: Record<string, number>; active: Run[] }; runs: Run[]; ledger?: { ok: boolean; state: string; quarantined?: string; action?: string } }
const BADGE: Record<string, string> = { RUNNING: "badge--accent", WAITING_FOR_APPROVAL: "badge--warn", COMPLETED: "badge--ok", FAILED: "badge--bad", CANCELLED: "", TIMED_OUT: "badge--bad", QUEUED: "" };
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 19) : "—");
const dur = (a: string, b: string | null) => { const s = (Date.parse(b ?? new Date().toISOString()) - Date.parse(a)) / 1000; return Number.isFinite(s) ? (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`) : "—"; };

function Detail({ run, jarvis, onAction }: { run: Run; jarvis: JarvisPayload | null; onAction: (m: string) => void }) {
  const livePending = jarvis?.pendingApproval ?? null;
  const approvalIsCurrent = !!(run.approval && livePending?.id && run.approval.id === livePending.id);
  async function send(body: Record<string, unknown>, ok: string) { const r = await askJarvis(body); onAction(r.ok ? ok : r.error ?? "failed"); }
  return (
    <section className="panel">
      <div className="panel__head"><span className="eyebrow">{run.id}</span><span className={`badge ${BADGE[run.state]}`}>{run.state.replace(/_/g, " ")}</span><span className="text-muted text-[11px]">{run.source} · {run.startedAt.slice(0, 16).replace("T", " ")} · {dur(run.startedAt, run.endedAt)}</span></div>
      <div className="px-4 py-3 text-[13px] flex flex-col gap-3">
        <div><div className="eyebrow mb-1">Request</div><div className="text-ink">{run.request}</div></div>
        {run.reply && <div><div className="eyebrow mb-1">Reply</div><div className="text-ink whitespace-pre-wrap">{run.reply}</div></div>}
        {run.error && <div><div className="eyebrow mb-1 text-offline">Error</div><div className="text-offline">{run.error}</div></div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
          <div><div className="eyebrow">Tool calls</div><div className="kpi">{run.toolCalls}</div></div>
          <div><div className="eyebrow">Failed</div><div className={`kpi ${run.toolFailures ? "text-offline" : ""}`}>{run.toolFailures}</div></div>
          <div><div className="eyebrow">Evidence</div><div className="text-ink mt-1">{run.verification.evidence === "tools" ? "tool observations backed this reply" : "conversation only — no tool evidence"}</div></div>
          <div><div className="eyebrow">Phase</div><div className="text-ink mt-1">{run.detail || "—"}</div></div>
        </div>
        {run.approval && (
          <div className="border border-line rounded p-3">
            <div className="eyebrow mb-1">Approval</div>
            <div className="text-ink">{run.approval.description}</div>
            <div className="text-muted text-[11px] mt-1">{run.approval.id} · {run.approval.resolved ?? (approvalIsCurrent ? "waiting for your answer" : run.state === "WAITING_FOR_APPROVAL" ? "waiting (not the live voice line's current approval — answer by voice or it expires on restart)" : "unresolved")}</div>
            {approvalIsCurrent && (
              <div className="flex gap-2 mt-2">
                <button className="btn btn--primary" onClick={() => send({ kind: "approve", approvalId: run.approval!.id }, "Approved.")}>Approve this action</button>
                <button className="btn" onClick={() => send({ kind: "decline", approvalId: run.approval!.id }, "Declined.")}>Decline</button>
              </div>
            )}
          </div>
        )}
        {run.state === "RUNNING" && jarvis?.running && <div><button className="btn btn--danger" onClick={() => send({ kind: "cancel" }, "Cancel sent.")}>Cancel this run</button></div>}
        <div>
          <div className="eyebrow mb-1">Tool timeline</div>
          {run.tools.length === 0 ? <div className="text-muted text-[12px]">no tools were used</div> : (
            <ol className="timeline">
              {run.tools.map((t) => <li key={t.id} className={`timeline__item ${t.ok === true ? "timeline__item--ok" : t.ok === false ? "timeline__item--bad" : "timeline__item--live"}`}><div className="text-[12px] text-ink">{t.summary || t.name}</div><div className="text-[10.5px] text-muted">{t.name.replace("mcp__jarvis__", "jarvis·")} · {hhmm(t.startedAt)}{t.endedAt ? ` → ${hhmm(t.endedAt)}` : " · running"}{t.ok === false ? " · failed" : ""}</div></li>)}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

export default function RunsCenter() {
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const runs = usePolling<RunsPayload>(`/api/runs?limit=100${state ? `&state=${state}` : ""}${source ? `&source=${source}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`, 3000);
  const jarvis = usePolling<JarvisPayload>("/api/jarvis", 3000);
  const current = runs.data?.runs.find((r) => r.id === selected) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[15px] tracking-[0.14em] text-ink">RUNS <span className="text-accent">//</span> TASK CENTER</span>
        <select className="input" style={{ width: "auto" }} value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">any state</option>{RUN_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <select className="input" style={{ width: "auto" }} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">any source</option>{RUN_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <input className="input" style={{ maxWidth: 260 }} placeholder="search requests and replies" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search runs" />
        {runs.data?.ledger && !runs.data.ledger.ok && (
          <div role="alert" className="w-full rounded-md border border-red-400/60 bg-red-500/10 px-3 py-2 text-[12px] text-ink">
            Runs ledger corrupt — nothing below is trustworthy. Quarantined copy: {runs.data.ledger.quarantined}. {runs.data.ledger.action}
          </div>
        )}
        <span className="ml-auto text-muted text-[11px]">{runs.data ? `${runs.data.summary.total} runs · ${Object.entries(runs.data.summary.byState).map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} ${v}`).join(" · ")}` : "loading…"}</span>
      </div>
      {msg && <div className="text-[12px] text-online" role="status">{msg}</div>}
      <div className={`grid grid-cols-1 ${current ? "xl:grid-cols-[1fr_1.4fr]" : ""} gap-4 items-start`}>
        <section className="panel">
          <div className="panel__head"><span className="eyebrow">History</span><span className="text-muted text-[11px]">newest first · bounded to the last 300 runs</span></div>
          {!runs.data ? <div className="text-muted text-[12px] p-4">loading…</div> : runs.data.runs.length === 0 ? <div className="text-muted text-[12px] p-4">No runs recorded yet. Every voice, typed or dashboard request lands here once the voice line handles it.</div> : (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th scope="col">When</th><th scope="col">Request</th><th scope="col">Source</th><th scope="col">Tools</th><th scope="col">State</th></tr></thead>
              <tbody>{runs.data.runs.map((r) => (
                <tr key={r.id} className={`hover-line ${selected === r.id ? "is-selected" : ""}`} onClick={() => setSelected(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(r.id)}>
                  <td className="text-muted tabular-nums whitespace-nowrap">{r.startedAt.slice(5, 16).replace("T", " ")}</td>
                  <td className="text-ink">{r.request.slice(0, 120)}</td>
                  <td className="text-muted">{r.source}</td>
                  <td className="tabular-nums">{r.toolCalls}{r.toolFailures ? <span className="text-offline"> ({r.toolFailures} failed)</span> : null}</td>
                  <td><span className={`badge ${BADGE[r.state]}`}>{r.state.replace(/_/g, " ")}</span></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
        {current && <Detail run={current} jarvis={jarvis.data} onAction={setMsg} />}
      </div>
    </div>
  );
}
