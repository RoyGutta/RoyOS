"use client";

import { useEffect, useMemo, useState } from "react";
import { usePolling } from "./usePolling";
import type { AgentInfo, Run, Task } from "@/lib/jarvis/types";

/**
 * Activity map — one spatial view of what Jarvis is doing: NOW (live runs, waiting approvals, today's usage), then the
 * DELEGATION tree (parent run → tasks with lease/claims/approval), then EVIDENCE for whatever is selected (tool
 * observations, verification, error). Depth is layout, not decoration: no animation, no transforms; keyboard-first
 * (every node is a button, arrow keys move within a column, Enter/Space selects); the selection is announced politely.
 */
interface RunsPayload { summary: { total: number; byState: Record<string, number>; active: Run[]; usage?: { runs: number; inputTokens: number; outputTokens: number; costUsd: number; capUsd: number | null; overCap: boolean } }; runs: Run[]; ledger?: { ok: boolean; state: string; quarantined?: string; action?: string } }
interface WfStep { id: string; do: string; state: string; attempts: number; evidence: { at: string; state: string; text: string; seconds?: number }[] }
interface Workflow { id: string; goal: string; state: string; updatedAt: string; summary?: string; steps: WfStep[]; filesChanged: string[]; approvalNeeded: { step: string; reason: string } | null; permissionNeeded: { step: string; detail: string } | null }
interface WorkflowsPayload { workflows: Workflow[]; corrupt: boolean; permissions: { at: string; rows: { capability: string; permission: string; status: string; fix: string }[] } | null }
interface AgentsPayload { agents: AgentInfo[]; open: Task[]; tasks: Task[]; tree: { parent: Run; children: Task[] }[]; schedulerAlive: boolean }

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const WF_BADGE: Record<string, string> = { running: "badge--accent", retrying: "badge--accent", waiting_for_approval: "badge--warn", waiting_for_permission: "badge--warn", needs_review: "badge--warn", blocked: "badge--bad", failed: "badge--bad", completed: "badge--ok", cancelled: "" };
const BADGE: Record<string, string> = { RUNNING: "badge--accent", WAITING_FOR_APPROVAL: "badge--warn", WAITING_FOR_DEPENDENCY: "badge--warn", COMPLETED: "badge--ok", FAILED: "badge--bad", TIMED_OUT: "badge--bad", BLOCKED: "badge--bad" };
const hhmm = (iso: string | null | undefined) => (iso ? iso.slice(11, 19) : "—");
const state = (s: string) => s.replace(/_/g, " ").toLowerCase();

function Node({ id, title, sub, st, selected, onSelect }: { id: string; title: string; sub?: string; st: string; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" data-node className={`w-full text-left rounded-md border px-3 py-2 ${selected ? "border-accent bg-accent/10" : "border-line"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
              aria-pressed={selected} onClick={() => onSelect(id)}>
        <span className={`badge ${BADGE[st] ?? ""} mr-2`}>{state(st)}</span>
        <span className="text-ink text-[13px]">{title}</span>
        {sub && <span className="block text-muted text-[11px] mt-0.5">{sub}</span>}
      </button>
    </li>
  );
}

function useArrowKeys() {
  // Up/Down moves between nodes inside the same column (buttons with data-node); Home/End jump. Nothing else is intercepted.
  return (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-node]"));
    const i = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === "ArrowDown" ? Math.min(nodes.length - 1, i + 1) : e.key === "ArrowUp" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : nodes.length - 1;
    nodes[j]?.focus();
  };
}

export default function ActivityMap() {
  const runs = usePolling<RunsPayload>("/api/runs?limit=40", 4000);
  const agents = usePolling<AgentsPayload>("/api/agents", 4000);
  const wfs = usePolling<WorkflowsPayload>("/api/workflows", 4000);
  const [openWf, setOpenWf] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const onKeys = useArrowKeys();

  const everything = useMemo(() => {
    const m = new Map<string, Run | Task>();
    for (const r of runs.data?.runs ?? []) m.set(r.id, r);
    for (const t of agents.data?.tasks ?? []) m.set(t.id, t);
    for (const { parent, children } of agents.data?.tree ?? []) { m.set(parent.id, parent); for (const c of children) m.set(c.id, c); }
    return m;
  }, [runs.data, agents.data]);
  const sel = selected ? everything.get(selected) ?? null : null;

  useEffect(() => { if (sel) setAnnounce(`${sel.id}: ${state(sel.state)}, ${sel.toolCalls} tool calls${sel.error ? ", error" : ""}`); }, [sel]);

  const live = (runs.data?.runs ?? []).filter((r) => !TERMINAL.has(r.state));
  const waiting = [...(runs.data?.runs ?? []).filter((r) => r.state === "WAITING_FOR_APPROVAL"), ...(agents.data?.open ?? []).filter((t) => t.approval && !t.approval.granted && !t.approval.resolved)];
  const usage = runs.data?.summary.usage;
  const ledger = runs.data?.ledger;

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">{announce}</p>
      {ledger && !ledger.ok && <div role="alert" className="rounded-md border border-red-400/60 bg-red-500/10 px-3 py-2 text-[12px] text-ink">Runs ledger corrupt — this map is not trustworthy. {ledger.action}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* depth 1: now */}
        <section className="panel" aria-labelledby="map-now">
          <div className="panel__head"><h2 id="map-now" className="eyebrow">Now</h2><span className="text-muted text-[11px]">{agents.data ? (agents.data.schedulerAlive ? "scheduler alive" : "scheduler idle") : "loading…"}</span></div>
          <div className="px-3 py-3 flex flex-col gap-3 text-[12px]">
            <div>
              <div className="eyebrow mb-1">Waiting for Roy ({waiting.length})</div>
              {waiting.length === 0 ? <div className="text-muted">nothing is waiting for an approval</div> : (
                <ul className="flex flex-col gap-1" onKeyDown={onKeys}>{waiting.map((w) => <Node key={w.id} id={w.id} title={"approval" in w && w.approval ? w.approval.description : w.request} sub={w.id} st={w.state} selected={selected === w.id} onSelect={setSelected} />)}</ul>
              )}
            </div>
            <div>
              <div className="eyebrow mb-1">Live runs ({live.length})</div>
              {live.length === 0 ? <div className="text-muted">idle</div> : (
                <ul className="flex flex-col gap-1" onKeyDown={onKeys}>{live.map((r) => <Node key={r.id} id={r.id} title={r.request} sub={`${r.source} · since ${hhmm(r.startedAt)} · ${r.detail || "—"}`} st={r.state} selected={selected === r.id} onSelect={setSelected} />)}</ul>
              )}
            </div>
            <div>
              <div className="eyebrow mb-1">Today</div>
              {usage ? (
                <dl className="grid grid-cols-3 gap-2">
                  <div><dt className="text-muted">runs</dt><dd className="kpi">{usage.runs}</dd></div>
                  <div><dt className="text-muted">tokens</dt><dd className="kpi">{(usage.inputTokens + usage.outputTokens).toLocaleString()}</dd></div>
                  <div><dt className="text-muted">est. cost</dt><dd className={`kpi ${usage.overCap ? "text-offline" : ""}`}>${usage.costUsd.toFixed(2)}{usage.capUsd ? ` / ${usage.capUsd}` : ""}</dd></div>
                </dl>
              ) : <div className="text-muted">—</div>}
              <div className="text-muted text-[10.5px] mt-1">SDK estimate; the subscription is not billed per call.</div>
            </div>
          </div>
        </section>
        {/* depth 2: delegation tree */}
        <section className="panel" aria-labelledby="map-tree">
          <div className="panel__head"><h2 id="map-tree" className="eyebrow">Delegations</h2><span className="text-muted text-[11px]">{agents.data?.open.length ?? 0} open task(s)</span></div>
          <div className="px-3 py-3 text-[12px] flex flex-col gap-3">
            {(agents.data?.tree ?? []).length === 0 && <div className="text-muted">no delegated work in the ledger window</div>}
            {(agents.data?.tree ?? []).slice(0, 12).map(({ parent, children }) => (
              <div key={parent.id}>
                <ul className="flex flex-col gap-1" onKeyDown={onKeys}>
                  <Node id={parent.id} title={parent.request} sub={`${parent.id} · parent`} st={parent.state} selected={selected === parent.id} onSelect={setSelected} />
                  <li>
                    <ul className="ml-4 border-l border-line pl-3 flex flex-col gap-1" onKeyDown={onKeys}>
                      {children.map((c) => <Node key={c.id} id={c.id} title={c.title || c.request} sub={`${c.agent}${c.lease ? ` · leased pid ${c.lease.pid}` : ""}${c.claims?.length ? ` · ${c.claims.length} claim(s)` : ""}${c.approval && !c.approval.granted ? " · needs approval" : ""}`} st={c.state} selected={selected === c.id} onSelect={setSelected} />)}
                    </ul>
                  </li>
                </ul>
              </div>
            ))}
          </div>
        </section>
        {/* depth 3: evidence */}
        <section className="panel" aria-labelledby="map-evidence">
          <div className="panel__head"><h2 id="map-evidence" className="eyebrow">Evidence</h2><span className="text-muted text-[11px]">{sel ? sel.id : "select a node"}</span></div>
          <div className="px-3 py-3 text-[12px] flex flex-col gap-3">
            {!sel && <div className="text-muted">Pick a run or task on the left. Arrow keys move inside a column; Enter selects.</div>}
            {sel && (
              <>
                <div><div className="eyebrow mb-1">Request</div><div className="text-ink">{sel.request}</div></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><div className="eyebrow">State</div><div className="text-ink">{state(sel.state)}</div></div>
                  <div><div className="eyebrow">Tool calls</div><div className="kpi">{sel.toolCalls}</div></div>
                  <div><div className="eyebrow">Failed</div><div className={`kpi ${sel.toolFailures ? "text-offline" : ""}`}>{sel.toolFailures}</div></div>
                </div>
                {"verification" in sel && sel.verification && <div><div className="eyebrow mb-1">Verification</div><div className="text-ink">{"evidence" in sel.verification ? (sel.verification.evidence === "tools" ? "tool observations back this result" : "conversation only — no tool evidence") : `${(sel as Task).verification.status} by ${(sel as Task).verification.by}${(sel as Task).verification.notes ? ` — ${(sel as Task).verification.notes}` : ""}`}</div></div>}
                {sel.error && <div><div className="eyebrow mb-1 text-offline">Error</div><div className="text-offline">{sel.error}</div></div>}
                {"approval" in sel && sel.approval && <div><div className="eyebrow mb-1">Approval</div><div className="text-ink">{sel.approval.description} · {("granted" in sel.approval && sel.approval.granted) ? "granted" : sel.approval.resolved ?? "pending"}</div></div>}
                <div>
                  <div className="eyebrow mb-1">Tool observations ({sel.tools.length})</div>
                  {sel.tools.length === 0 ? <div className="text-muted">none</div> : (
                    <ol className="flex flex-col gap-1">
                      {sel.tools.map((t) => <li key={t.id} className="text-ink"><span className={`badge ${t.ok === false ? "badge--bad" : t.ok ? "badge--ok" : "badge--accent"} mr-2`}>{t.ok === null ? "running" : t.ok ? "ok" : "failed"}</span>{t.summary || t.name}<span className="text-muted"> · {hhmm(t.startedAt)}</span></li>)}
                    </ol>
                  )}
                </div>
                {"artifacts" in sel && ((sel as Task).artifacts?.length ?? 0) > 0 && <div><div className="eyebrow mb-1">Artifacts</div><ul className="text-ink">{(sel as Task).artifacts.map((a) => <li key={a} className="break-all">{a}</li>)}</ul></div>}
                {"handoff" in sel && ((sel as Task).handoff?.filesChanged?.length ?? 0) > 0 && <div><div className="eyebrow mb-1">Files changed</div><ul className="text-ink">{((sel as Task).handoff?.filesChanged ?? []).slice(0, 20).map((f) => <li key={f} className="break-all">{f}</li>)}</ul></div>}
              </>
            )}
          </div>
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-2" aria-labelledby="map-wf">
          <div className="panel__head"><h2 id="map-wf" className="eyebrow">Computer tasks</h2><span className="text-muted text-[11px]">{wfs.data ? `${wfs.data.workflows.length} recent` : "loading…"}</span></div>
          <div className="px-3 py-3 text-[12px] flex flex-col gap-2">
            {wfs.data?.corrupt && <div role="alert" className="rounded-md border border-red-400/60 bg-red-500/10 px-3 py-2 text-ink">Workflow store corrupt — restore logs/workflows.json and remove the .CORRUPT marker.</div>}
            {(wfs.data?.workflows ?? []).length === 0 && <div className="text-muted">no multi-step computer tasks yet</div>}
            <ul className="flex flex-col gap-2">
              {(wfs.data?.workflows ?? []).map((w) => (
                <li key={w.id} className="rounded-md border border-line">
                  <button type="button" className="w-full text-left px-3 py-2" aria-expanded={openWf === w.id} onClick={() => setOpenWf(openWf === w.id ? null : w.id)}>
                    <span className={`badge ${WF_BADGE[w.state] ?? ""} mr-2`}>{state(w.state)}</span>
                    <span className="text-ink">{w.goal}</span>
                    <span className="block text-muted text-[11px] mt-0.5">{w.id} · {w.steps.filter((s) => s.state === "completed").length}/{w.steps.length} steps · {hhmm(w.updatedAt)}{w.filesChanged.length ? ` · ${w.filesChanged.length} file(s) changed` : ""}</span>
                  </button>
                  {openWf === w.id && (
                    <div className="px-3 pb-3 flex flex-col gap-2">
                      {w.approvalNeeded && <div className="text-ink"><span className="badge badge--warn mr-2">needs Roy</span>{w.approvalNeeded.reason}</div>}
                      {w.permissionNeeded && <div className="text-ink"><span className="badge badge--warn mr-2">permission</span>{w.permissionNeeded.detail}</div>}
                      <ol className="flex flex-col gap-1">
                        {w.steps.map((st) => (
                          <li key={st.id}><span className={`badge ${WF_BADGE[st.state] ?? ""} mr-2`}>{state(st.state)}</span><span className="text-ink">{st.do}</span>
                            {st.evidence.length > 0 && <span className="text-muted"> — {st.evidence[st.evidence.length - 1].text}</span>}
                            {st.attempts > 1 && <span className="text-muted"> · {st.attempts} attempts</span>}</li>
                        ))}
                      </ol>
                      {w.filesChanged.length > 0 && <div><div className="eyebrow">Files changed</div><ul className="text-ink">{w.filesChanged.map((f) => <li key={f} className="break-all">{f}</li>)}</ul></div>}
                      {w.summary && <div className="text-muted">{w.summary}</div>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="panel" aria-labelledby="map-perm">
          <div className="panel__head"><h2 id="map-perm" className="eyebrow">Mac permissions</h2><span className="text-muted text-[11px]">{wfs.data?.permissions ? `measured ${hhmm(wfs.data.permissions.at)} by the voice line` : "not measured yet"}</span></div>
          <div className="px-3 py-3 text-[12px]">
            {!wfs.data?.permissions && <div className="text-muted">Start the voice line; it measures permissions from inside Terminal at startup.</div>}
            <ul className="flex flex-col gap-1">
              {(wfs.data?.permissions?.rows ?? []).filter((r) => r.permission !== "none").map((r) => (
                <li key={r.capability}><span className={`badge ${String(r.status).startsWith("granted") ? "badge--ok" : "badge--warn"} mr-2`}>{String(r.status).replace(/_/g, " ").slice(0, 40)}</span><span className="text-ink">{r.permission}</span><span className="block text-muted text-[11px]">{r.capability}</span></li>
              ))}
            </ul>
          </div>
        </section>
      </div>
      <p className="text-muted text-[11px] px-1">Read-only. Approve or decline from the Assistant page; this map never changes state. States are the ledger&apos;s own words (planned, running, waiting for approval, blocked, completed, failed, cancelled, timed out).</p>
    </div>
  );
}
