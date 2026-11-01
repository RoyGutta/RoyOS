"use client";

import { useEffect, useState } from "react";
import { usePolling } from "./usePolling";
import { askJarvis } from "./CommandBar";
import { DECISIONS, LEAD_VIEWS, SERVICES, VIEW_LABEL, type LeadRecord, type LeadView } from "@/lib/business/leads";
import type { Doc, Client, Project, Task } from "@/lib/business/store";

type LeadRow = LeadRecord & { priority: string };
interface ListPayload { exists: boolean; view: LeadView; counts: Record<LeadView, number>; syntheticCount: number; leads: LeadRow[] }
interface DetailPayload { lead: LeadRow; documents: Doc[]; client: Client | null; project: Project | null; tasks: Task[] }
interface JarvisLite { running: boolean }

const PRIO: Record<string, string> = { HIGH: "badge--ok", MEDIUM: "badge--warn", LOW: "" };
const VER: Record<string, string> = { verified: "badge--ok", plausible: "badge--warn", hypothesis: "", missing: "badge--bad" };
const DECISION_LABEL: Record<string, string> = { qualified: "Qualified", interested: "Interested", contacted_manually: "I contacted them", not_fit: "Not a fit", not_now: "Not now", won: "Won the deal", needs_verification: "Needs verification", verified: "Verified", archived: "Archive", reopen: "Reopen", lost: "Lost" };

async function act(body: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const r = await fetch("/api/leads/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok: boolean; message?: string; error?: string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col min-h-0">
      <div className="panel__head"><span className="eyebrow">{title}</span>{sub && <span className="text-muted text-[11px] truncate">{sub}</span>}{right && <span className="ml-auto">{right}</span>}</div>
      <div className="px-4 py-3 text-[13px]">{children}</div>
    </section>
  );
}

function LeadDetail({ id, running, onChanged }: { id: string; running: boolean; onChanged: () => void }) {
  const { data, refresh } = usePolling<DetailPayload>(`/api/leads?id=${encodeURIComponent(id)}`, 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [service, setService] = useState<string>("new_website");
  const [highlight, setHighlight] = useState<string | null>(null);

  async function run(label: string, body: Record<string, unknown>) {
    setBusy(label); setMsg(null);
    const r = await act(body);
    setBusy(null);
    setMsg({ ok: r.ok, text: r.message ?? r.error ?? (r.ok ? "done" : "failed") });
    refresh(); onChanged();
  }
  async function ask(text: string) {
    setBusy("ask"); const r = await askJarvis({ text }); setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? "Sent to Jarvis — watch the Command Center." : r.error ?? "failed" });
  }

  if (!data) return <div className="text-muted text-[12px] p-4">loading…</div>;
  const l = data.lead;
  const won = ["WON", "DELIVERY", "RETAINER"].includes(l.status);
  const evidence = l.evidence ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Panel title={l.business} sub={`${l.id} · ${l.status}${l.synthetic ? " · SYNTHETIC (test data)" : ""}`} right={<span className={`badge ${PRIO[l.priority]}`}>{l.priority} priority</span>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
          <div><div className="eyebrow">Score</div><div className="kpi">{l.score ?? "–"}<span className="text-muted text-[12px]">/100</span></div><div className="text-muted">{l.confidence ?? "LOW"} confidence</div></div>
          <div><div className="eyebrow">Website</div>{l.website ? <a className="text-accent break-all" href={l.website} target="_blank" rel="noreferrer noopener">{l.domain || l.website}</a> : <span className="text-muted">none recorded</span>}<div className="text-muted">{l.verification ?? "UNVERIFIED"}</div></div>
          <div><div className="eyebrow">Where</div><div className="text-ink">{l.geography || "—"}</div><div className="text-muted">{l.industry || "—"}</div></div>
          <div><div className="eyebrow">Found via</div><div className="text-ink">{l.discoverySource || l.source || "—"}</div><div className="text-muted">{(l.sourceUrls ?? []).length} source URL(s)</div></div>
        </div>
        {(l.possibleDuplicates ?? []).length > 0 && <div className="mt-2 text-[12px] text-warn">Possible duplicate of {l.possibleDuplicates!.join(", ")} — kept separate; decide manually.</div>}
        {l.nextAction && <div className="mt-2 text-[12px]"><span className="eyebrow mr-2">Next</span><span className="text-ink">{l.nextAction}</span>{l.nextFollowUp && <span className="text-muted"> · follow-up {l.nextFollowUp.slice(0, 10)}</span>}</div>}
        {(l.serviceFit ?? []).length > 0 && <div className="mt-2 text-[12px]"><span className="eyebrow mr-2">Service fit</span>{l.serviceFit!.map((f) => <span key={f} className="badge badge--accent mr-1">{f.replace(/_/g, " ")}</span>)}</div>}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Actions" sub={running ? "deterministic actions run locally; research goes to Jarvis" : "voice line offline: audit/decisions still work; research needs Jarvis"}>
          <div className="flex flex-wrap gap-2 mb-3">
            <button className="btn" disabled={!!busy || !l.website} onClick={() => run("audit", { action: "audit", lead: l.id })} title={l.website ? "One read-only fetch of the home page" : "No website recorded"}>{busy === "audit" ? "Auditing…" : "Audit website"}</button>
            <button className="btn" disabled={!!busy} onClick={() => run("score", { action: "score", lead: l.id })}>Rescore</button>
            <button className="btn" disabled={!!busy || !running} onClick={() => ask(`Research lead ${l.id} (${l.business}): audit its site, read its pages, confirm the business from its own site with lead_evidence, then explain the score and what the site is missing.`)}>Ask Jarvis to research</button>
            <button className="btn" disabled={!!busy || !running} onClick={() => ask(`Draft a proposal for lead ${l.id} (${l.business}) using the best-fitting service from business_catalog and the recorded evidence; save it with business_create_document as a proposal linked to the lead. Mark prices and timelines as estimates.`)}>Ask Jarvis to draft a proposal</button>
          </div>
          <div className="eyebrow mb-1">Your decision</div>
          <input className="input mb-2" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
          <div className="flex flex-wrap gap-2">
            {DECISIONS.map((d) => <button key={d} className={`btn btn--sm ${d === "won" ? "btn--primary" : ""}`} disabled={!!busy} onClick={() => run(d, { action: "decide", lead: l.id, decision: d, note })}>{DECISION_LABEL[d]}</button>)}
          </div>
          {won && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="eyebrow mb-1">Convert to client + project</div>
              <div className="flex gap-2 items-center flex-wrap">
                <select className="input" style={{ width: "auto" }} value={service} onChange={(e) => setService(e.target.value)} aria-label="Service">
                  {SERVICES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
                <button className="btn btn--primary" disabled={!!busy} onClick={() => run("convert", { action: "convert", lead: l.id, service })}>{l.projectId ? "Re-check conversion" : "Create client & project"}</button>
                <span className="text-muted text-[11px]">idempotent: never duplicates</span>
              </div>
            </div>
          )}
          {msg && <div className={`mt-3 text-[12px] whitespace-pre-wrap ${msg.ok ? "text-online" : "text-offline"}`} role="status">{msg.text}</div>}
        </Panel>

        <Panel title="Score breakdown" sub="every point names its evidence">
          {(l.scoreBreakdown ?? []).length === 0 ? <div className="text-muted text-[12px]">No scoring evidence yet. Audit the website or ask Jarvis to research.</div> : (
            <table className="table">
              <thead><tr><th scope="col">Finding</th><th scope="col">Points</th><th scope="col">Evidence</th></tr></thead>
              <tbody>
                {l.scoreBreakdown!.map((r) => (
                  <tr key={r.dimension} className="hover-line" onClick={() => setHighlight(r.evidenceId)}>
                    <td className="text-ink">{r.note}</td>
                    <td className="tabular-nums">{r.points}<span className="text-muted">/{r.max}</span></td>
                    <td><span className={`badge ${VER[r.verification] ?? ""}`}>{r.verification}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-muted text-[10.5px] mt-2">Not measured anywhere here: Lighthouse, Core Web Vitals, accessibility conformance, rendered mobile layout. A high score with LOW confidence is a weak lead.</div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Evidence" sub={`${evidence.length} item(s)`}>
          {evidence.length === 0 ? <div className="text-muted text-[12px]">none recorded</div> : (
            <ul className="space-y-1.5">
              {[...evidence].reverse().map((e) => (
                <li key={e.id} className={`text-[12px] flex gap-2 items-start ${highlight === e.id ? "bg-accent/10 rounded px-1" : ""}`}>
                  <span className={`badge ${VER[e.verification]}`}>{e.verification}</span>
                  <span className="text-ink flex-1">{e.claim}{e.url && <> · <a className="text-accent" href={e.url} target="_blank" rel="noreferrer noopener">source</a></>}</span>
                  <span className="text-muted tabular-nums shrink-0">{e.observedAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="History & links">
          <div className="text-[12px] mb-2">
            {data.documents.length > 0 ? data.documents.map((d) => <div key={d.id} className="flex gap-2"><span className="chip">{d.type}</span><span className="text-ink truncate">{d.title}</span><span className={`badge ${d.status === "REVIEW" ? "badge--warn" : ""}`}>{d.status}</span></div>) : <span className="text-muted">no documents yet</span>}
            {data.client && <div className="mt-1">Client: <a className="text-accent" href="/business">{data.client.name}</a></div>}
            {data.project && <div>Project: <a className="text-accent" href="/business">{data.project.name}</a> · {data.project.status} · {data.tasks.filter((t) => t.status === "DONE").length}/{data.tasks.length} tasks done</div>}
          </div>
          <div className="eyebrow mb-1">Activity</div>
          <ul className="space-y-1">
            {[...(l.activity ?? [])].reverse().slice(0, 10).map((a, i) => <li key={i} className="text-[12px] flex gap-2"><span className="text-muted tabular-nums shrink-0">{a.at.slice(5, 16)}</span><span className="text-muted">{a.by}</span><span className="text-ink">{a.what}</span></li>)}
            {(l.activity ?? []).length === 0 && <li className="text-muted text-[12px]">nothing yet</li>}
          </ul>
          {(l.contactChannels ?? []).length > 0 && <div className="mt-2 text-[12px]"><span className="eyebrow mr-2">Contact</span>{l.contactChannels!.map((c, i) => <span key={i} className="chip mr-1">{c.kind}: {c.value}</span>)}</div>}
          {l.notes && <div className="mt-2 text-[12px] text-muted whitespace-pre-wrap">{l.notes.slice(0, 400)}</div>}
        </Panel>
      </div>
    </div>
  );
}

function ImportBox({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    let cands: unknown;
    try { cands = JSON.parse(text); } catch { setMsg("Not valid JSON. Expected a list of {business, website, sourceUrl, geography, industry, phone, email, noWebsite}."); return; }
    setBusy(true);
    const r = await act({ action: "import", candidates: cands, source: "import" });
    setBusy(false);
    setMsg(r.message ?? r.error ?? "done");
    if (r.ok) { setText(""); onDone(); }
  }
  return (
    <div>
      <button className="btn btn--sm" onClick={() => setOpen(!open)}>{open ? "Close import" : "Import research results"}</button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-muted text-[11px]">Paste legitimate research results as JSON (each needs the sourceUrl you found it on). Test data must carry &quot;synthetic&quot;: true — it is kept out of the real views.</div>
          <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Candidates JSON" placeholder='[{"business":"…","website":"…","sourceUrl":"https://…","geography":"…","industry":"…"}]' />
          <div className="flex gap-2 items-center"><button className="btn btn--primary" disabled={busy || !text.trim()} onClick={submit}>{busy ? "Importing…" : "Import"}</button>{msg && <span className="text-[11px] text-muted whitespace-pre-wrap">{msg}</span>}</div>
        </div>
      )}
    </div>
  );
}

export default function LeadsWorkspace() {
  const [view, setView] = useState<LeadView>("all");
  const [showSynthetic, setShowSynthetic] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = usePolling<ListPayload>(`/api/leads?view=${view}${showSynthetic ? "&synthetic=1" : ""}`, 4000);
  const jarvis = usePolling<JarvisLite>("/api/jarvis", 5000);
  const running = jarvis.data?.running ?? false;
  const rows = (list.data?.leads ?? []).filter((l) => !q || `${l.business} ${l.domain ?? ""} ${l.geography ?? ""} ${l.industry ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (selected && list.data && !list.data.leads.some((l) => l.id === selected)) setSelected(null);
  }, [list.data, selected]);

  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[15px] tracking-[0.14em] text-ink">LEADS <span className="text-accent">//</span> PROSPECTING</span>
        <input className="input" style={{ maxWidth: 260 }} placeholder="search business, domain, place" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
        <label className="text-[11px] text-muted flex items-center gap-1"><input type="checkbox" checked={showSynthetic} onChange={(e) => setShowSynthetic(e.target.checked)} /> show sample/synthetic ({list.data?.syntheticCount ?? 0})</label>
        <div className="ml-auto"><ImportBox onDone={list.refresh} /></div>
      </div>
      <nav className="flex flex-wrap gap-1" aria-label="Lead views">
        {LEAD_VIEWS.map((v) => <button key={v} className={`chip ${view === v ? "text-online" : "text-muted"}`} onClick={() => setView(v)}>{VIEW_LABEL[v]} <span className="tabular-nums">{list.data?.counts[v] ?? "·"}</span></button>)}
      </nav>
      {list.error && <div className="text-offline text-[12px]">Could not load leads: {list.error}</div>}
      <div className={`grid grid-cols-1 ${selected ? "xl:grid-cols-[1fr_1.6fr]" : ""} gap-4 items-start`}>
        <section className="panel">
          <div className="panel__head"><span className="eyebrow">{VIEW_LABEL[view]}</span><span className="text-muted text-[11px]">{rows.length} shown · sorted by score</span></div>
          {!list.data ? <div className="text-muted text-[12px] p-4">loading…</div> : rows.length === 0 ? (
            <div className="text-muted text-[12px] p-4">{list.data.counts.all === 0 ? <>No real leads yet. Ask Jarvis: “find ten potential website clients in &lt;city&gt;”, or import research results.</> : "Nothing in this view."}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th scope="col">Business</th><th scope="col">Stage</th><th scope="col">Score</th><th scope="col">Priority</th><th scope="col">Where</th><th scope="col">Updated</th></tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className={`hover-line ${selected === l.id ? "is-selected" : ""}`} onClick={() => setSelected(l.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(l.id)}>
                      <td><div className="text-ink">{l.business}{l.synthetic ? <span className="badge badge--bad ml-2">synthetic</span> : null}{(l.possibleDuplicates ?? []).length > 0 ? <span className="badge badge--warn ml-2">dup?</span> : null}</div><div className="text-muted text-[11px]">{l.domain || "no site"}</div></td>
                      <td><span className="chip">{l.status}</span></td>
                      <td className="tabular-nums">{l.score ?? "–"} <span className="text-muted text-[10.5px]">{l.confidence ?? "LOW"}</span></td>
                      <td><span className={`badge ${PRIO[l.priority]}`}>{l.priority}</span></td>
                      <td className="text-muted">{l.geography || "—"}</td>
                      <td className="text-muted tabular-nums">{l.updatedAt.slice(5, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {selected && <LeadDetail id={selected} running={running} onChanged={list.refresh} />}
      </div>
    </div>
  );
}
