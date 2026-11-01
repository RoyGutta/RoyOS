"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";
import type { Lead, Client, Project, Task, Doc, ContentItem, RevenueEvent, AuditEntry, Attention } from "@/lib/business/store";

interface Payload {
  exists: boolean;
  summary: { month: string; revenue: { received: number; pending: number; recurring: number; provenance: string }; pipeline: { value: number; stages: Record<string, number> }; clients: number; projects: number; content: Record<string, number>; attention: Attention[] };
  integrations: readonly { name: string; state: string; note: string }[];
  leads: Lead[]; clients: Client[]; projects: Project[]; tasks: Task[]; documents: Doc[]; content: ContentItem[]; revenue: RevenueEvent[]; audit: AuditEntry[];
}

const STAGES = ["PROSPECT", "CONTACTED", "REPLIED", "QUALIFIED", "CALL", "PROPOSAL", "WON", "DELIVERY", "RETAINER"];
const CSTAGES = ["IDEA", "RESEARCH", "SCRIPT", "ASSETS", "RENDER", "QA", "APPROVAL", "QUEUE", "PUBLISHED", "ANALYTICS"];
const VIEWS = ["command", "pipeline", "projects", "content", "revenue", "documents", "integrations"] as const;
type View = (typeof VIEWS)[number];
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col min-h-0">
      <div className="panel__head"><span className="eyebrow">{title}</span>{sub && <span className="text-muted text-[11px]">{sub}</span>}</div>
      <div className="px-4 py-3 text-[13px]">{children}</div>
    </section>
  );
}

function AskJarvis() {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function send() {
    if (!text.trim()) return;
    const r = await fetch("/api/jarvis/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const j = (await r.json()) as { ok: boolean; error?: string };
    setMsg(j.ok ? "Sent to Jarvis — watch the Jarvis panel." : j.error ?? "failed");
    if (j.ok) setText("");
  }
  return (
    <div className="flex gap-2 items-center">
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask Jarvis… e.g. what should I work on?" className="flex-1 bg-transparent border border-line rounded px-3 py-2 text-ink text-[13px] outline-none" />
      <button onClick={send} className="chip text-online">Ask</button>
      {msg && <span className="text-muted text-[11px]">{msg}</span>}
    </div>
  );
}

function Board({ stages, items, render }: { stages: string[]; items: { id: string; status: string }[]; render: (i: never) => React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 lg:grid-cols-9 gap-2">
      {stages.map((st) => (
        <div key={st} className="panel p-2 min-h-[140px]"><div className="eyebrow mb-2">{st}</div>
          {items.filter((i) => i.status === st).map((i) => <div key={i.id} className="text-[12px] text-ink border border-line rounded p-2 mb-2">{render(i as never)}</div>)}
        </div>
      ))}
    </div>
  );
}

export default function BusinessOS() {
  const { data } = usePolling<Payload>("/api/business", 2000);
  const [view, setView] = useState<View>("command");
  if (!data) return <div className="text-muted text-[12px] p-4">loading…</div>;
  const s = data.summary;
  const clientName = (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const active = data.projects.filter((p) => p.status !== "DONE");

  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[15px] tracking-[0.14em] text-ink">JARVIS <span className="text-accent">//</span> BUSINESS OS</span>
        <nav className="flex flex-wrap gap-1 ml-2">
          {VIEWS.map((v) => <button key={v} onClick={() => setView(v)} className={`chip ${view === v ? "text-online" : "text-muted"}`}>{v.toUpperCase()}</button>)}
        </nav>
        {!data.exists && <span className="text-muted text-[11px] ml-auto">no data yet — ask Jarvis to create a lead</span>}
      </div>
      <div className="panel px-4 py-3"><AskJarvis /></div>

      {view === "command" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Panel title="Revenue" sub={s.month}><div className="text-ink text-[20px]">{money(s.revenue.received)}</div><div className="text-muted text-[11px]">pending {money(s.revenue.pending)} · recurring {money(s.revenue.recurring)}</div><div className="text-muted text-[10px] mt-1">{s.revenue.provenance}</div></Panel>
            <Panel title="Pipeline"><div className="text-ink text-[20px]">{money(s.pipeline.value)}</div><div className="text-muted text-[11px]">{Object.entries(s.pipeline.stages).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ") || "no leads"}</div></Panel>
            <Panel title="Active work"><div className="text-ink text-[20px]">{s.projects} projects</div><div className="text-muted text-[11px]">{s.clients} active clients</div></Panel>
            <Panel title="Content"><div className="text-ink text-[20px]">{s.content.APPROVAL ?? 0} awaiting approval</div><div className="text-[11px]"><a className="text-accent" href="/content">open the Content OS →</a></div><div className="text-muted text-[11px]">{Object.entries(s.content).filter(([, v]) => v).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ") || "no items"}</div></Panel>
          </div>
          <Panel title="What needs attention" sub="deterministic: due dates, approvals, READY content">
            {s.attention.length === 0 ? <div className="text-muted">Nothing due or waiting. Ask Jarvis: “what should I work on?”</div> : (
              <ol className="space-y-1">{s.attention.map((a, i) => <li key={a.id} className="flex gap-3"><span className="text-muted tabular-nums">{i + 1}.</span><span className="text-ink">{a.title}</span><span className="text-muted">— {a.why}</span></li>)}</ol>
            )}
          </Panel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Active projects">{active.length === 0 ? <div className="text-muted">none</div> : active.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-1"><span className="text-ink flex-1 truncate">{p.name}</span><span className="text-muted text-[11px]">{clientName(p.clientId)}</span><span className="chip text-muted">{p.status}</span><span className="w-24 h-1.5 bg-line rounded overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${p.progress}%` }} /></span></div>
            ))}</Panel>
            <Panel title="Recent activity" sub="audit log">{data.audit.slice(-8).reverse().map((a) => <div key={a.id} className="flex gap-3 text-[12px]"><span className="text-muted tabular-nums shrink-0">{a.at.slice(11, 16)}</span><span className="text-ink truncate">{a.action.replace(/_/g, " ")}: {a.result}</span>{a.approval === "pending" && <span className="chip text-offline">approval</span>}</div>)}{data.audit.length === 0 && <div className="text-muted">nothing yet</div>}</Panel>
          </div>
        </>
      )}

      {view === "pipeline" && (
        <>
          <Board stages={STAGES} items={data.leads} render={(l: Lead) => <><div className="truncate">{l.business}</div><div className="text-muted text-[10px]">{l.serviceInterest || "—"}{l.estimatedValue ? ` · ${money(l.estimatedValue)}` : ""}</div>{l.nextFollowUp && <div className="text-muted text-[10px]">follow-up {l.nextFollowUp.slice(0, 10)}</div>}</>} />
          <div className="text-muted text-[11px]">lost / not now / unqualified: {data.leads.filter((l) => ["LOST", "NOT_NOW", "UNQUALIFIED"].includes(l.status)).length}</div>
        </>
      )}

      {view === "projects" && (data.projects.length === 0 ? <div className="text-muted text-[12px] p-4">no projects</div> : data.projects.map((p) => (
        <Panel key={p.id} title={p.name} sub={`${p.kind} · ${clientName(p.clientId)} · ${p.status}${p.deadline ? ` · due ${p.deadline.slice(0, 10)}` : ""}`}>
          <ul className="space-y-1">{data.tasks.filter((t) => t.projectId === p.id).sort((a, b) => a.order - b.order).map((t) => <li key={t.id} className="flex gap-2"><span className={t.status === "DONE" ? "text-online" : "text-muted"}>{t.status === "DONE" ? "✓" : "○"}</span><span className={t.status === "DONE" ? "text-muted line-through" : "text-ink"}>{t.title}</span>{t.due && <span className="text-muted text-[10px]">due {t.due.slice(0, 10)}</span>}</li>)}</ul>
        </Panel>
      )))}

      {view === "content" && <Board stages={CSTAGES} items={data.content} render={(c: ContentItem) => <><div className="truncate">{c.title}</div><div className="text-muted text-[10px]">{c.platform}{c.hook ? ` · ${c.hook.slice(0, 40)}` : ""}</div></>} />}

      {view === "revenue" && (
        <Panel title="Revenue events" sub="entered locally · no processor connected">{data.revenue.length === 0 ? <div className="text-muted">none entered</div> : <table className="w-full text-[12px]"><tbody>{[...data.revenue].reverse().map((r) => <tr key={r.id} className="border-b border-line"><td className="py-1 text-muted">{r.date}</td><td className="text-ink">{money(r.amount)}</td><td className="text-muted">{r.channel}</td><td className="text-muted">{r.status}{r.recurring ? " · recurring" : ""}</td><td className="text-muted">{clientName(r.clientId)}</td><td className="text-muted truncate">{r.note}</td></tr>)}</tbody></table>}</Panel>
      )}

      {view === "documents" && (
        <Panel title="Documents" sub="drafts stay drafts until you send them">{data.documents.length === 0 ? <div className="text-muted">none</div> : [...data.documents].reverse().map((d) => <div key={d.id} className="flex gap-3 py-1 text-[12px]"><span className="chip text-muted">{d.type}</span><span className="text-ink flex-1 truncate">{d.title}</span><span className={`chip ${d.status === "REVIEW" ? "text-offline" : "text-muted"}`}>{d.status}</span><span className="text-muted truncate max-w-[40%]">{d.path}</span></div>)}</Panel>
      )}

      {view === "integrations" && (
        <Panel title="Integrations" sub="only what is actually connected is marked connected">{data.integrations.map((i) => <div key={i.name} className="flex gap-3 py-1 text-[12px]"><span className="text-ink w-40">{i.name}</span><span className={`chip ${i.state === "CONNECTED" ? "text-online" : "text-offline"}`}>{i.state}</span><span className="text-muted">{i.note}</span></div>)}</Panel>
      )}
    </div>
  );
}
