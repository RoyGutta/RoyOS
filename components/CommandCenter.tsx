"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";
import CommandBar, { askJarvis } from "./CommandBar";
import type { JarvisPayload } from "@/app/api/jarvis/route";
import type { Run } from "@/lib/jarvis/types";
import type { Attention } from "@/lib/business/store";
import type { LeadView } from "@/lib/business/leads";

const STATES = ["IDLE", "LISTENING", "TRANSCRIBING", "THINKING", "TOOL_EXECUTION", "WAITING_FOR_APPROVAL", "SPEAKING", "ERROR"] as const;
const STATE_LABEL: Record<string, string> = { IDLE: "Ready", LISTENING: "Recording", TRANSCRIBING: "Transcribing", THINKING: "Thinking", TOOL_EXECUTION: "Using a tool", WAITING_FOR_APPROVAL: "Needs approval", SPEAKING: "Speaking", ERROR: "Error", OFFLINE: "Offline", BACKGROUND_WORK: "Background" };
const RUN_BADGE: Record<string, string> = { RUNNING: "badge--accent", WAITING_FOR_APPROVAL: "badge--warn", COMPLETED: "badge--ok", FAILED: "badge--bad", CANCELLED: "", TIMED_OUT: "badge--bad", QUEUED: "" };
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "—");

interface BusinessPayload { exists: boolean; summary: { month: string; revenue: { received: number; pending: number; recurring: number; provenance: string }; pipeline: { value: number; stages: Record<string, number> }; clients: number; projects: number; content: Record<string, number>; attention: Attention[] }; documents: { id: string; type: string; status: string; title: string }[]; projects: { id: string; name: string; status: string; progress: number }[] }
interface LeadsPayload { counts: Record<LeadView, number>; syntheticCount: number; leads: { id: string; business: string; score: number | null; confidence?: string; priority: string; status: string }[] }
interface RunsPayload { summary: { total: number; byState: Record<string, number>; current: Run | null }; runs: Run[] }
interface SystemPayload { services: { name: string; up: boolean; required: boolean; note: string }[]; integrations: readonly { name: string; state: string }[]; voice: { engineOrder: string } }

const EXAMPLES = [
  "What should I work on right now?",
  "Find ten potential website clients in Tampa.",
  "Show me the strongest leads.",
  "Research this business and tell me what its website is missing.",
  "Create a website proposal draft for the top lead.",
  "Summarize what you accomplished today.",
  "Show me what needs my approval.",
  "Inspect my current project and run the tests.",
];

function Panel({ title, sub, right, children, className = "" }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel flex flex-col min-h-0 ${className}`}>
      <div className="panel__head"><span className="eyebrow">{title}</span>{sub && <span className="text-muted text-[11px] truncate">{sub}</span>}{right && <span className="ml-auto">{right}</span>}</div>
      <div className="px-4 py-3 text-[13px] min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

function ToolTimeline({ run, max = 6 }: { run: Run; max?: number }) {
  const tools = run.tools.slice(-max);
  if (tools.length === 0) return <div className="text-muted text-[12px]">no tool calls yet</div>;
  return (
    <ol className="timeline">
      {tools.map((t) => (
        <li key={t.id} className={`timeline__item ${t.ok === true ? "timeline__item--ok" : t.ok === false ? "timeline__item--bad" : "timeline__item--live"}`}>
          <div className="text-[12px] text-ink truncate">{t.summary || t.name.replace("mcp__jarvis__", "")}</div>
          <div className="text-[10.5px] text-muted">{hhmm(t.startedAt)}{t.endedAt ? ` → ${hhmm(t.endedAt)}` : " · running"}{t.ok === false ? " · failed" : ""}</div>
        </li>
      ))}
    </ol>
  );
}

export default function CommandCenter() {
  const j = usePolling<JarvisPayload>("/api/jarvis", 1500);
  const b = usePolling<BusinessPayload>("/api/business", 4000);
  const l = usePolling<LeadsPayload>("/api/leads?view=high_priority", 5000);
  const r = usePolling<RunsPayload>("/api/runs?limit=6", 3000);
  const s = usePolling<SystemPayload>("/api/system", 12000);
  const [prefill, setPrefill] = useState("");
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null);

  const data = j.data;
  const running = data?.running ?? false;
  const state = data?.state ?? "OFFLINE";
  const busy = running && !["IDLE", "WAITING_FOR_APPROVAL", "ERROR"].includes(state);
  const current = data?.currentRun ?? null;
  const pending = data?.pendingApproval ?? null;
  const attention = b.data?.summary.attention ?? [];
  const proposals = b.data?.documents.filter((d) => d.type === "proposal" && d.status === "REVIEW") ?? [];
  const counts = l.data?.counts;
  const down = s.data?.services.filter((x) => x.required && !x.up) ?? [];

  async function decide(kind: "approve" | "decline") {
    if (!pending?.id) { setApprovalMsg("This approval has no id (older voice line); say yes or no to Jarvis directly."); return; }
    const res = await askJarvis({ kind, approvalId: pending.id });
    setApprovalMsg(res.ok ? (kind === "approve" ? "Approved — Jarvis will run it now." : "Declined.") : res.error ?? "failed");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 1. What is Jarvis doing right now */}
      <section className="panel">
        <div className="panel__head">
          <span className={!running ? "dot dot--offline" : busy ? "dot dot--active dot--live" : state === "ERROR" ? "dot dot--offline" : "dot dot--online"} aria-hidden />
          <span className="eyebrow">Jarvis</span>
          <span className={`chip ${!running || state === "ERROR" ? "text-offline" : state === "WAITING_FOR_APPROVAL" ? "text-warn" : "text-online"}`}>{STATE_LABEL[state] ?? state}</span>
          <span className="text-muted text-[11px] truncate">{data?.detail || (running ? "listening for a request" : "voice line not running")}</span>
          <span className="ml-auto text-muted text-[11px] hidden md:inline">brain: Claude (subscription) · local model: none · voice: {s.data?.voice.engineOrder ?? "—"}{data?.resumed ? " · conversation resumed" : ""}</span>
        </div>
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="state-strip" aria-label="Runtime state">
            {STATES.map((st) => (
              <div key={st} className={`state-strip__cell ${state === st ? (st === "ERROR" ? "state-strip__cell--error" : "state-strip__cell--on") : ""}`}>{STATE_LABEL[st]}</div>
            ))}
          </div>
          <CommandBar running={running} busy={busy} initial={prefill} key={prefill} />
          {(data?.lastYou || data?.lastJarvis) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
              <div><div className="eyebrow mb-1">You</div><div className="text-ink line-clamp-2">{data?.lastYou ?? "—"}</div></div>
              <div><div className="eyebrow mb-1">Jarvis</div><div className="text-ink line-clamp-3">{data?.lastJarvis ?? "—"}</div></div>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 2. Current task */}
        <Panel title="Current task" sub={current ? current.id : "nothing running"} right={current && <span className={`badge ${RUN_BADGE[current.state]}`}>{current.state.replace(/_/g, " ")}</span>}>
          {current ? (
            <div className="flex flex-col gap-2">
              <div className="text-ink">{current.request}</div>
              <div className="text-muted text-[11px]">from {current.source} · started {hhmm(current.startedAt)} · phase: {current.detail || STATE_LABEL[state] || "—"}</div>
              <ToolTimeline run={current} />
            </div>
          ) : (
            <div className="text-muted text-[12px]">{running ? "Jarvis is idle. Ask for something above or hold Right Option and speak." : "Start the voice line to run tasks; past runs are in the Runs workspace."}</div>
          )}
          {r.data && r.data.runs.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="eyebrow mb-1.5">Recent runs · <a className="text-accent" href="/runs">all</a></div>
              <ul className="space-y-1">
                {r.data.runs.filter((x) => x.id !== current?.id).slice(0, 5).map((x) => (
                  <li key={x.id} className="flex gap-2 text-[12px] items-center">
                    <span className="text-muted tabular-nums shrink-0">{hhmm(x.startedAt)}</span>
                    <span className="text-ink truncate flex-1">{x.request}</span>
                    <span className={`badge ${RUN_BADGE[x.state]}`}>{x.state.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* 3. Needs your attention */}
        <Panel title="Needs your attention" sub="approvals, proposals, due items, errors">
          {pending ? (
            <div className="border border-warn/50 rounded p-3 mb-3">
              <div className="eyebrow text-warn mb-1">Approval requested</div>
              <div className="text-ink mb-2">{pending.description}</div>
              {pending.fullText ? (
                <div className="mb-2">
                  <div className="text-[11px] text-muted mb-1">Full text you are approving ({pending.fullText.length} characters)</div>
                  <pre className="text-[12px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto border border-line rounded p-2" tabIndex={0} aria-label="Full text of the message you are approving">{pending.fullText}</pre>
                </div>
              ) : null}
              <div className="flex gap-2 items-center flex-wrap">
                <button className="btn btn--primary" onClick={() => decide("approve")}>Approve this action</button>
                <button className="btn" onClick={() => decide("decline")}>Decline</button>
                <span className="text-muted text-[11px]">bound to {pending.id ?? "this action"} only</span>
              </div>
              {approvalMsg && <div className="text-[11px] mt-2 text-online" role="status">{approvalMsg}</div>}
            </div>
          ) : null}
          {down.length > 0 && (
            <div className="text-[12px] mb-2 text-offline">{down.map((d) => d.name).join(", ")} not running · <a className="text-accent" href="/system">system</a></div>
          )}
          {(data?.errors.length ?? 0) > 0 && (
            <ul className="mb-2 space-y-1">
              {data!.errors.slice(-3).reverse().map((e, i) => <li key={i} className="text-[12px] text-offline"><span className="text-muted tabular-nums mr-2">{clock(e.ts)}</span>{e.where}: {e.message}</li>)}
            </ul>
          )}
          {proposals.length > 0 && (
            <ul className="mb-2 space-y-1">
              {proposals.map((p) => <li key={p.id} className="text-[12px] flex gap-2"><span className="badge badge--warn">review</span><span className="text-ink truncate">{p.title}</span><a className="text-accent ml-auto" href="/business">open</a></li>)}
            </ul>
          )}
          {attention.length === 0 && proposals.length === 0 && !pending && down.length === 0 && (data?.errors.length ?? 0) === 0 ? (
            <div className="text-muted text-[12px]">Nothing waiting. Ask “what should I work on?” for a ranked list.</div>
          ) : (
            <ol className="space-y-1">
              {attention.slice(0, 8).map((a, i) => <li key={a.id} className="flex gap-2 text-[12px]"><span className="text-muted tabular-nums">{i + 1}.</span><span className="text-ink">{a.title}</span><span className="text-muted">— {a.why}</span></li>)}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 4. Business snapshot */}
        <Panel title="Leads" sub="prospecting" right={<a className="text-accent text-[11px]" href="/leads">open</a>}>
          {counts ? (
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div><div className="kpi">{counts.high_priority}</div><div className="text-muted">high priority</div></div>
              <div><div className="kpi">{counts.new}</div><div className="text-muted">new</div></div>
              <div><div className="kpi">{counts.needs_verification}</div><div className="text-muted">need verification</div></div>
              <div><div className="kpi">{counts.qualified}</div><div className="text-muted">qualified</div></div>
              {counts.all === 0 && <div className="col-span-2 text-muted">No real leads yet{(l.data?.syntheticCount ?? 0) > 0 ? ` (${l.data!.syntheticCount} sample record hidden)` : ""}. Try “find ten potential website clients in …”.</div>}
            </div>
          ) : <div className="text-muted text-[12px]">loading…</div>}
        </Panel>
        <Panel title="Clients & projects" sub="delivery" right={<a className="text-accent text-[11px]" href="/business">open</a>}>
          {b.data ? (
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div><div className="kpi">{b.data.summary.clients}</div><div className="text-muted">active clients</div></div>
              <div><div className="kpi">{b.data.summary.projects}</div><div className="text-muted">open projects</div></div>
              <div className="col-span-2 text-muted">{proposals.length} proposal(s) in review · pipeline {money(b.data.summary.pipeline.value)} (estimates, not revenue)</div>
            </div>
          ) : <div className="text-muted text-[12px]">loading…</div>}
        </Panel>
        <Panel title="Revenue" sub={b.data?.summary.month}>
          {b.data ? (
            <div className="text-[12px]">
              <div className="kpi">{money(b.data.summary.revenue.received)}</div>
              <div className="text-muted">received this month · pending {money(b.data.summary.revenue.pending)}</div>
              <div className="text-muted text-[10.5px] mt-1">{b.data.summary.revenue.provenance}</div>
            </div>
          ) : <div className="text-muted text-[12px]">loading…</div>}
        </Panel>
        <Panel title="System" sub="real checks" right={<a className="text-accent text-[11px]" href="/system">open</a>}>
          {s.data ? (
            <ul className="space-y-1 text-[12px]">
              {s.data.services.slice(0, 5).map((x) => <li key={x.name} className="flex items-center gap-2"><span className={`dot ${x.up ? "dot--online" : x.required ? "dot--offline" : ""}`} aria-hidden /><span className="text-ink">{x.name}</span><span className="text-muted ml-auto">{x.up ? "up" : "down"}</span></li>)}
              <li className="text-muted">{s.data.integrations.filter((i) => i.state === "CONNECTED").length}/{s.data.integrations.length} integrations connected · <a className="text-accent" href="/content">content</a></li>
            </ul>
          ) : <div className="text-muted text-[12px]">checking…</div>}
        </Panel>
      </div>

      {/* 5. What you can ask */}
      <Panel title="What you can ask" sub="each maps to real tools; click to prefill">
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <button key={e} className="btn btn--sm" onClick={() => setPrefill(e)}>{e}</button>)}
        </div>
      </Panel>
    </div>
  );
}
