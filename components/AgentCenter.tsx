"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";
import { askJarvis } from "./CommandBar";
import SignInToApprove from "./SignInToApprove";
import { approvalHeaders, useApprovalSession, type ApprovalSession } from "./useApprovalSession";
import { AGENT_IDS, type AgentInfo, type Run, type Task } from "@/lib/jarvis/types";
import type { JarvisPayload } from "@/app/api/jarvis/route";

interface Payload { agents: AgentInfo[]; scheduler: { maxWorkers?: number; effectiveLimit?: number; reason?: string; active?: string[]; queued?: number; updatedAt?: string } | null; open: Task[]; tasks: Task[]; tree: { parent: Run; children: Task[] }[]; schedulerAlive: boolean }
const BADGE: Record<string, string> = { RUNNING: "badge--accent", VERIFYING: "badge--accent", ASSIGNED: "badge--accent", WAITING_FOR_APPROVAL: "badge--warn", WAITING_FOR_DEPENDENCY: "badge--warn", BLOCKED: "badge--warn", PAUSED: "", QUEUED: "", COMPLETED: "badge--ok", FAILED: "badge--bad", CANCELLED: "", TIMED_OUT: "badge--bad" };
const AGENT_BADGE: Record<string, string> = { IDLE: "", QUEUED: "", WORKING: "badge--accent", VERIFYING: "badge--accent", WAITING_FOR_APPROVAL: "badge--warn", BLOCKED: "badge--warn", FAILED: "badge--bad", COMPLETED: "badge--ok" };
const hhmm = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : "—");
const label = (s: string) => s.toLowerCase().replace(/_/g, " ");

async function act(body: Record<string, unknown>, csrf?: string | null) {
  try {
    const r = await fetch("/api/agents/action", { method: "POST", headers: approvalHeaders(csrf), body: JSON.stringify(body) });
    return (await r.json()) as { ok: boolean; message?: string; error?: string; task?: string };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "request failed" }; }
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel flex flex-col min-h-0"><div className="panel__head"><span className="eyebrow">{title}</span>{sub && <span className="text-muted text-[11px] truncate">{sub}</span>}{right && <span className="ml-auto">{right}</span>}</div><div className="px-4 py-3 text-[13px]">{children}</div></section>;
}

function TaskDetail({ t, byId, onAction, session }: { t: Task; byId: Map<string, Task>; onAction: (m: string) => void; session: ApprovalSession }) {
  const [busy, setBusy] = useState(false);
  async function go(body: Record<string, unknown>) { setBusy(true); const r = await act(body, session.csrf); setBusy(false); if (!r.ok && body.action === "approve") session.refresh(); onAction(r.message ?? r.error ?? (r.ok ? "done" : "failed")); }
  const h = t.handoff;
  const live = ["RUNNING", "VERIFYING", "ASSIGNED"].includes(t.state);
  return (
    <section className="panel">
      <div className="panel__head"><span className="eyebrow">{t.id}</span><span className={`badge ${BADGE[t.state] ?? ""}`}>{label(t.state)}</span><span className="text-muted text-[11px]">{t.agent} · by {t.assignedBy} · parent {t.parentId ?? "—"} · retries {t.retries}/{t.maxRetries}</span></div>
      <div className="px-4 py-3 text-[13px] flex flex-col gap-3">
        <div><div className="eyebrow mb-1">Request</div><div className="text-ink whitespace-pre-wrap">{t.request}</div></div>
        {t.acceptance && <div><div className="eyebrow mb-1">Acceptance</div><div className="text-ink">{t.acceptance}</div></div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
          <div><div className="eyebrow">Phase</div><div className="text-ink mt-1">{t.detail || "—"}</div></div>
          <div><div className="eyebrow">Tools</div><div className="kpi">{t.toolCalls}{t.toolFailures ? <span className="text-offline text-[12px]"> ({t.toolFailures} failed)</span> : null}</div></div>
          <div><div className="eyebrow">Verification</div><div className="text-ink mt-1">{t.verification?.status ?? "pending"}{t.verification?.notes ? <span className="text-muted"> — {t.verification.notes}</span> : null}</div></div>
          <div><div className="eyebrow">Deps / claims</div><div className="text-ink mt-1">{t.deps.length ? t.deps.map((d) => <span key={d} className="chip mr-1">{d} {byId.get(d)?.state ? label(byId.get(d)!.state) : ""}</span>) : "none"}{t.claims.length ? <div className="text-muted break-all">{t.claims.join(", ")}</div> : null}</div></div>
        </div>
        {t.error && <div className="text-offline text-[12px]">{t.error}</div>}
        {t.approval && (
          <div className="border border-warn/50 rounded p-3">
            <div className="eyebrow text-warn mb-1">Approval {t.approval.granted ? "granted" : "needed"}</div>
            <div className="text-ink">{t.approval.description}</div>
            {!t.approval.granted && t.state === "WAITING_FOR_APPROVAL" && <div className="flex gap-2 mt-2 items-center">{session.state === "signed-in" ? <button className="btn btn--primary" disabled={busy} onClick={() => go({ action: "approve", task: t.id, approvalId: t.approval!.id })}>Approve this exact action</button> : <SignInToApprove session={session} next="/agents" />}<button className="btn" disabled={busy} onClick={() => go({ action: "cancel", task: t.id })}>Decline (cancel task)</button></div>}
            <div className="text-muted text-[10.5px] mt-1">bound to {t.approval.id}; the worker performs it once and cannot grant it to itself</div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          {(live || ["QUEUED", "WAITING_FOR_DEPENDENCY", "BLOCKED", "WAITING_FOR_APPROVAL"].includes(t.state)) && <button className="btn btn--danger" disabled={busy || t.cancelRequested} onClick={() => go({ action: "cancel", task: t.id })}>{t.cancelRequested ? "Cancel requested…" : live ? "Stop at next step" : "Cancel"}</button>}
          {["FAILED", "CANCELLED", "TIMED_OUT", "BLOCKED"].includes(t.state) && <button className="btn" disabled={busy} onClick={() => go({ action: "retry", task: t.id })}>Retry</button>}
          {t.state === "COMPLETED" && <button className="btn" disabled={busy} onClick={() => go({ action: "enqueue", agent: "reviewer", request: `Independently review task ${t.id} ('${t.title}'): run the relevant tests read-only, check the acceptance criteria (${t.acceptance || "none given"}), cite files and commands, list findings.`, title: `Review: ${t.title.slice(0, 80)}`, inputs: [t.id], parent: t.parentId ?? undefined })}>Ask QA to review</button>}
        </div>
        {live && <div className="text-muted text-[10.5px]">A running worker is interrupted at its next step; a tool call already in flight cannot be cut mid-call.</div>}
        {h && (
          <div className="border border-line rounded p-3">
            <div className="eyebrow mb-1">Handoff report · {h.status}</div>
            <div className="text-[12px] text-ink"><b>Completed:</b> {h.completed || "—"}</div>
            {h.filesChanged.length > 0 && <div className="text-[12px]"><b>Files:</b> {h.filesChanged.map((f) => <span key={f} className="chip mr-1 break-all">{f.replace(/^\/Users\/[^/]+\/Documents\//, "")}</span>)}</div>}
            <div className="text-[12px] text-ink"><b>Tests:</b> {h.testsRun.length ? h.testsRun.join(" · ") : "none run"} {h.testsEstablished && <span className="text-muted">— {h.testsEstablished}</span>}</div>
            {h.remaining && <div className="text-[12px] text-warn"><b>Remaining:</b> {h.remaining}</div>}
            {h.decisionsNeeded.length > 0 && <div className="text-[12px] text-warn"><b>Decisions needed:</b> {h.decisionsNeeded.join("; ")}</div>}
            {h.nextTask && <div className="text-[12px] text-muted"><b>Suggested next:</b> {h.nextTask}</div>}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div><div className="eyebrow mb-1">Tool timeline</div>{t.tools.length === 0 ? <div className="text-muted text-[12px]">no tools yet</div> : <ol className="timeline">{t.tools.slice(-30).map((x) => <li key={x.id} className={`timeline__item ${x.ok === true ? "timeline__item--ok" : x.ok === false ? "timeline__item--bad" : "timeline__item--live"}`}><div className="text-[12px] text-ink">{x.summary || x.name}</div><div className="text-[10.5px] text-muted">{hhmm(x.startedAt)}{x.endedAt ? ` → ${hhmm(x.endedAt)}` : " · running"}{x.ok === false ? " · failed" : ""}</div></li>)}</ol>}</div>
          <div><div className="eyebrow mb-1">Events</div><ul className="space-y-0.5">{(t.events ?? []).slice(-20).reverse().map((e, i) => <li key={i} className="text-[11.5px] flex gap-2"><span className="text-muted tabular-nums shrink-0">{hhmm(e.at)}</span><span className="text-ink">{e.what}</span></li>)}</ul></div>
        </div>
        {t.reply && <details className="text-[12px]"><summary className="text-muted cursor-pointer">Worker transcript tail</summary><pre className="whitespace-pre-wrap text-ink mt-2">{t.reply}</pre></details>}
      </div>
    </section>
  );
}

function AssignForm({ onDone }: { onDone: (m: string) => void }) {
  const [agent, setAgent] = useState<string>("business");
  const [title, setTitle] = useState(""); const [request, setRequest] = useState(""); const [acceptance, setAcceptance] = useState(""); const [claims, setClaims] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const r = await act({ action: "enqueue", agent, request, title, acceptance, claims: claims.split(",").map((c) => c.trim()).filter(Boolean) });
    setBusy(false); onDone(r.ok ? `Queued ${r.task}` : r.error ?? r.message ?? "failed");
    if (r.ok) { setTitle(""); setRequest(""); setAcceptance(""); setClaims(""); }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap"><select className="input" style={{ width: "auto" }} value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent">{AGENT_IDS.map((a) => <option key={a} value={a}>{a}</option>)}</select><input className="input" placeholder="title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" /></div>
      <textarea className="input" rows={3} placeholder="request — instructions a colleague could act on alone (at least a sentence)" value={request} onChange={(e) => setRequest(e.target.value)} aria-label="Request" />
      <input className="input" placeholder="acceptance criteria (how 'done' is judged)" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} aria-label="Acceptance" />
      <input className="input" placeholder="claims: absolute paths this task may edit, comma-separated (must be inside the role's scope)" value={claims} onChange={(e) => setClaims(e.target.value)} aria-label="Claims" />
      <div><button className="btn btn--primary" disabled={busy || request.trim().length < 20} onClick={submit}>{busy ? "Queuing…" : "Assign task"}</button></div>
    </div>
  );
}

export default function AgentCenter() {
  const { data, refresh } = usePolling<Payload>("/api/agents", 3000);
  const jarvis = usePolling<JarvisPayload>("/api/jarvis", 4000);
  const session = useApprovalSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [bigAsk, setBigAsk] = useState("");
  const running = jarvis.data?.running ?? false;
  const byId = new Map<string, Task>((data?.tasks ?? []).map((t) => [t.id, t]));
  const sel = data?.tasks.find((t) => t.id === selected) ?? null;
  const s = data?.scheduler;
  async function delegateViaJarvis() {
    const r = await askJarvis({ text: bigAsk });
    setMsg(r.ok ? "Sent to Jarvis — it will plan and delegate; watch the tree below." : r.error ?? "failed");
    if (r.ok) setBigAsk("");
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[15px] tracking-[0.14em] text-ink">AGENTS <span className="text-accent">//</span> CONTROL CENTER</span>
        <span className={`badge ${data?.schedulerAlive ? "badge--ok" : "badge--bad"}`}>{data?.schedulerAlive ? "scheduler live" : "scheduler offline"}</span>
        <span className="text-muted text-[11px]">{s ? `limit ${s.effectiveLimit ?? "?"}/${s.maxWorkers ?? "?"} workers — ${s.reason ?? ""} · ${s.active?.length ?? 0} active · ${s.queued ?? 0} queued` : "runs inside the voice line; start-jarvis.command"}</span>
        {msg && <span className="ml-auto text-[11px] text-online" role="status">{msg}</span>}
      </div>
      {!data?.schedulerAlive && <div className="text-[12px] text-warn">Tasks can be queued now; they run once the voice line (which hosts the scheduler) is up. Nothing here is executing.</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {(data?.agents ?? []).map((a) => {
          const cur = a.currentTaskId ? byId.get(a.currentTaskId) as Task | undefined : undefined;
          const working = ["WORKING", "VERIFYING"].includes(a.status);
          return (
            <section key={a.id} className="panel">
              <div className="panel__head"><span className={`dot ${working ? "dot--active dot--live" : a.status === "IDLE" ? "dot--online" : a.status === "FAILED" ? "dot--offline" : ""}`} aria-hidden /><span className="eyebrow">{a.name}</span><span className={`badge ml-auto ${AGENT_BADGE[a.status] ?? ""}`}>{label(a.status)}</span></div>
              <div className="px-4 py-3 text-[12px] flex flex-col gap-1.5">
                <div className="text-muted">{a.responsibility}</div>
                {cur ? <div className="text-ink"><span className="eyebrow mr-1">Now</span><button className="text-accent text-left" onClick={() => setSelected(cur.id)}>{cur.title}</button><div className="text-muted">{cur.detail}</div></div> : <div className="text-muted">no current task</div>}
                {a.recent.length > 0 && <div><span className="eyebrow mr-1">Last</span><button className="text-left text-ink" onClick={() => setSelected(a.recent[a.recent.length - 1].task)}>{a.recent[a.recent.length - 1].title}</button> <span className={`badge ${BADGE[a.recent[a.recent.length - 1].state] ?? ""}`}>{label(a.recent[a.recent.length - 1].state)}</span></div>}
                <div className="text-muted text-[10.5px]">session {a.sessionId ? `resumable (${a.sessionId.slice(0, 8)})` : "none yet"} · scope {a.writeRoots.length ? a.writeRoots.map((r) => r.replace(/^\/Users\/[^/]+\/Documents\//, "")).join(", ") : "read-only"} · shell {a.bash || "none"} · {a.tools.length} tools</div>
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Ask the coordinator" sub="Jarvis plans and delegates a larger request (same runtime as voice)">
          <div className="flex gap-2"><input className="input" value={bigAsk} onChange={(e) => setBigAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && delegateViaJarvis()} placeholder={running ? "e.g. Have Tidefable research a video about automotive engineering while the business agent finds prospects in Tampa" : "voice line offline — start-jarvis.command"} aria-label="Coordinator request" /><button className="btn btn--primary" disabled={!bigAsk.trim() || !running} onClick={delegateViaJarvis}>Send</button></div>
        </Panel>
        <Panel title="Assign a task directly" sub="queued in the shared ledger under 'dashboard'"><AssignForm onDone={(m) => { setMsg(m); refresh(); }} /></Panel>
      </div>

      <Panel title="Task orchestration" sub="parent requests with their delegated children; states come from the ledger">
        {!data ? <div className="text-muted text-[12px]">loading…</div> : data.tree.length === 0 ? <div className="text-muted text-[12px]">No delegated work yet. Ask Jarvis for something bigger than a turn, or assign a task above.</div> : (
          <div className="flex flex-col gap-3">
            {data.tree.map((n) => (
              <div key={n.parent.id} className="border border-line rounded p-3">
                <div className="text-[12px] text-muted mb-1"><span className="chip mr-2">{n.parent.id}</span>{"request" in n.parent ? n.parent.request : ""} <span className={`badge ml-2 ${BADGE[n.parent.state] ?? ""}`}>{label(n.parent.state)}</span></div>
                <table className="table"><thead><tr><th scope="col">Task</th><th scope="col">Agent</th><th scope="col">State</th><th scope="col">Phase</th><th scope="col">Deps</th><th scope="col">Tools</th></tr></thead><tbody>
                  {n.children.map((c) => <tr key={c.id} className={`hover-line ${selected === c.id ? "is-selected" : ""}`} onClick={() => setSelected(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(c.id)}>
                    <td className="text-ink">{c.title}</td><td className="text-muted">{c.agent}</td><td><span className={`badge ${BADGE[c.state] ?? ""}`}>{label(c.state)}</span></td><td className="text-muted">{c.detail}</td><td className="text-muted">{c.deps.length ? c.deps.length : "—"}</td><td className="tabular-nums">{c.toolCalls}</td>
                  </tr>)}
                </tbody></table>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {sel && <TaskDetail t={sel} byId={byId} session={session} onAction={(m) => { setMsg(m); refresh(); }} />}
    </div>
  );
}
