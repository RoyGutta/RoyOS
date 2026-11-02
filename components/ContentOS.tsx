"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";
import SignInToApprove from "./SignInToApprove";
import { approvalHeaders, useApprovalSession, type ApprovalSession } from "./useApprovalSession";
import { FORMATS, RIGHTS_STATES, STAGES } from "@/lib/content/types";
import type { ContentItem, ContentPayload, FormatReport } from "@/lib/content/types";

const VIEWS = ["pipeline", "approval", "queue", "experiments", "platforms", "readiness", "history"] as const;
const STATE_CLASS: Record<string, string> = { DONE: "text-online", READY: "text-online", REQUIRED: "text-accent", BLOCKED: "text-offline", "NOT READY": "text-offline", PENDING: "text-muted", MANUAL: "text-accent", TESTING: "text-accent", SUBMITTED: "text-accent", PAUSED: "text-muted" };
type View = (typeof VIEWS)[number];
const RIGHTS_CLASS: Record<string, string> = { OWNER: "text-online", LICENSED: "text-online", PERMITTED: "text-online", PUBLIC_DOMAIN: "text-online", EXCEPTION_REVIEW: "text-accent", UNKNOWN: "text-offline", NOT_ALLOWED: "text-offline" };
const VERDICT: Record<string, string> = { KEEP: "text-online", STOP: "text-offline", ITERATE: "text-accent", HOLD: "text-muted", COLLECTING: "text-muted" };
const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(2)}%`);

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col min-h-0">
      <div className="panel__head"><span className="eyebrow">{title}</span>{sub && <span className="text-muted text-[11px]">{sub}</span>}</div>
      <div className="px-4 py-3 text-[13px]">{children}</div>
    </section>
  );
}

type ActResult = { status: number; ok?: boolean; error?: string; nonce?: string };
/** The two approve actions must carry the session-bound X-CSRF; the server refuses them otherwise (G9-2). */
async function act(body: Record<string, unknown>, csrf?: string | null): Promise<ActResult> {
  try {
    const r = await fetch("/api/content/action", { method: "POST", headers: approvalHeaders(csrf), body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; nonce?: string };
    return { status: r.status, ...j };
  } catch (e) { return { status: 0, ok: false, error: e instanceof Error ? e.message : "request failed" }; }
}
const said = (j: ActResult) => (j.ok ? "done" : j.error ?? "failed");
const VERSION = /^[a-f0-9]{64}$/;

function Detail({ c, onMsg, session }: { c: ContentItem; onMsg: (m: string) => void; session: ApprovalSession }) {
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const [rights, setRights] = useState(c.source?.rights ?? "UNKNOWN");
  const [rightsNote, setRightsNote] = useState("");
  // Roy's TWO tier: the nonce from click 1 lives here, for THIS item and displayed version only, until click 2 succeeds.
  const [first, setFirst] = useState<{ id: string; version: string; nonce: string } | null>(null);
  const s = c.script;
  const failed = c.qa.checks.filter((k) => !k.ok);
  // G9-5: the version Roy SEES is the one both clicks sign; the runtime refuses it when the item changed since.
  const version = typeof c.reviewVersion === "string" && VERSION.test(c.reviewVersion) ? c.reviewVersion : null;
  const signedIn = session.state === "signed-in";
  const firstDone = !!first && !!version && first.id === c.id && first.version === version;
  async function approve(body: Record<string, unknown>): Promise<ActResult> {
    const j = await act(body, session.csrf);
    if (j.status === 401 || j.status === 403) session.refresh();   // the session ended: the buttons give way to "Sign in to approve"
    return j;
  }
  async function approveFirst() {
    if (!version) return;
    const j = await approve({ action: "approve-first", id: c.id, version });
    setFirst(j.ok && typeof j.nonce === "string" ? { id: c.id, version, nonce: j.nonce } : null);
    onMsg(j.ok ? "1 of 2 recorded — confirm at least 2 s and at most 5 min later" : said(j));
  }
  async function approveSecond() {
    if (!firstDone || !version || !first) return;
    const j = await approve({ action: "approve", id: c.id, version, nonce: first.nonce, at: at || undefined, note });
    if (j.ok) setFirst(null);
    onMsg(said(j));
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      <div className="flex flex-col gap-2">
        {c.render.thumbnail && <img src={`/api/content/media?id=${c.id}&kind=thumb`} alt="" className="w-full rounded border border-line" />}
        {c.render.video && <video src={`/api/content/media?id=${c.id}&kind=video`} controls className="w-full rounded border border-line" />}
        <div className="text-muted text-[11px]">{c.kind} · {FORMATS[c.format] ?? c.format} · targets {c.platformTargets.join(", ")}</div>
        {c.render.tts && <div className="text-muted text-[11px]">voice {c.render.tts.engine} · captions {c.render.alignment?.method} · {fmt(c.render.narrationSeconds, 1)}s</div>}
      </div>
      <div className="flex flex-col gap-3">
        {(c.format === "viral_moment" || c.source?.url || c.source?.localPath) && (
          <div className="border border-line rounded p-3 flex flex-col gap-2">
            <div className="eyebrow">Source &amp; rights</div>
            <div className="text-[12px] text-ink">{c.source?.creator || "creator —"} · {c.source?.url ? <a className="text-accent" href={c.source.url} target="_blank" rel="noreferrer">{c.source.url}</a> : "no URL"}{c.source?.localPath ? <span className="text-muted"> · local file</span> : ""}</div>
            <div className="flex items-center gap-2 text-[12px]"><span className={`chip ${RIGHTS_CLASS[c.source?.rights ?? "UNKNOWN"]}`}>{c.source?.rights ?? "UNKNOWN"}</span><span className="text-muted">{c.source?.rightsNote || "no rights note"}{c.source?.rightsBy ? ` · set by ${c.source.rightsBy} ${c.source.rightsAt?.slice(0, 10)}` : ""}</span></div>
            {c.source?.selected && <div className="text-[12px] text-ink">moment {c.source.selected.start}s–{c.source.selected.end}s · <span className="text-muted">{c.source.selected.why}</span></div>}
            <div className="text-muted text-[11px]">Credit, a disclaimer, captions, music, a crop or an AI edit never change the rights state. Record only what is true; the item cannot pass SCRIPT while UNKNOWN or NOT_ALLOWED.</div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={rights} onChange={(e) => setRights(e.target.value)} className="bg-transparent border border-line rounded px-2 py-1 text-ink text-[12px]">{RIGHTS_STATES.map((r) => <option key={r} value={r} className="bg-black">{r}</option>)}</select>
              <input value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} placeholder="basis: licence / permission / ownership / PD source / reviewer: name" className="flex-1 bg-transparent border border-line rounded px-2 py-1 text-ink text-[12px]" />
              <button className="chip text-muted" onClick={async () => onMsg(said(await act({ action: "rights", id: c.id, state: rights, note: rightsNote })))}>Record rights</button>
            </div>
          </div>
        )}
        <div><span className="eyebrow">Angle</span><div className="text-ink">{c.angle || "—"}</div></div>
        <div><span className="eyebrow">Hook</span><div className="text-ink">{s?.hook || c.hook || "—"}</div></div>
        {s && (<>
          <div><span className="eyebrow">Script · {s.words} words</span><div className="text-ink whitespace-pre-wrap max-h-48 overflow-auto text-[12px]">{s.script}</div></div>
          <div><span className="eyebrow">Caption</span><div className="text-ink text-[12px]">{s.caption}</div><div className="text-muted text-[11px]">{s.hashtags.map((h) => `#${h}`).join(" ")}</div></div>
          <div className="text-muted text-[11px]">disclosure: AI voice {String(s.disclosure.aiVoice)} · generated art {String(s.disclosure.generatedArt)} · credits {s.disclosure.credits.length}</div>
        </>)}
        {c.sources.length > 0 && <div><span className="eyebrow">Sources</span>{c.sources.map((u) => <div key={u} className="text-[11px] truncate"><a className="text-accent" href={u} target="_blank" rel="noreferrer">{u}</a></div>)}</div>}
        <div><span className="eyebrow">QA · {c.qa.status}</span>
          {failed.length > 0 ? failed.map((k) => <div key={k.name} className="text-offline text-[12px]">✗ {k.name}: {k.detail}</div>) : c.qa.checks.length > 0 ? <div className="text-online text-[12px]">all {c.qa.checks.length} checks passed{c.qa.lufs !== undefined && c.qa.lufs !== null ? ` · ${c.qa.lufs} LUFS` : ""}</div> : <div className="text-muted text-[12px]">not run</div>}
        </div>
        {c.errors.length > 0 && <div className="text-offline text-[12px]">last error · {c.errors[c.errors.length - 1].stage}: {c.errors[c.errors.length - 1].message}</div>}
        {Object.entries(c.publish).filter(([, p]) => p.status !== "none").map(([k, p]) => <div key={k} className="text-[12px]"><span className="chip text-muted">{k}</span> {p.status}{p.url && <> · <a className="text-accent" href={p.url} target="_blank" rel="noreferrer">{p.url}</a></>}{p.lastError && <span className="text-offline"> · {p.lastError}</span>}</div>)}
        {c.status === "APPROVAL" && (
          <div className="border border-line rounded p-3 flex flex-col gap-2">
            <div className="eyebrow">Approval — explicit human action</div>
            <div className="text-muted text-[11px]">Watch the video once. Publishing takes two separate confirmations: click 1 of 2, then 2 of 2 (at least 2 s later, within 5 min), both for the version shown here. It is then queued for the publisher at the time below (default: next weekday 15:00).</div>
            <div className="text-[11px]"><span className="text-muted">Version you are approving: </span>{version ? <code className="break-all">{version}</code> : <span className="text-offline" role="status">Version unavailable — re-run QA</span>}</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="bg-transparent border border-line rounded px-2 py-1 text-ink text-[12px]" />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (required to reject)" className="flex-1 bg-transparent border border-line rounded px-2 py-1 text-ink text-[12px]" />
              {!signedIn && <SignInToApprove session={session} next="/content" />}
              {signedIn && !firstDone && <button className="chip text-muted disabled:opacity-50" disabled={!version} onClick={() => void approveFirst()}>Approve (1 of 2)</button>}
              {signedIn && firstDone && <button className="chip text-online disabled:opacity-50" disabled={!version} onClick={() => void approveSecond()}>Confirm publish (2 of 2)</button>}
              <button className="chip text-offline" onClick={async () => onMsg(note ? said(await act({ action: "reject", id: c.id, note })) : "a note is required to reject")}>Reject</button>
            </div>
          </div>
        )}
        {c.status === "QUEUE" && (
          <div className="border border-line rounded p-3 flex flex-wrap gap-2 items-center">
            <span className="text-ink text-[12px]">Queued for {c.schedule.publishAt} · approved by {c.approval.by}</span>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="bg-transparent border border-line rounded px-2 py-1 text-ink text-[12px]" />
            <button className="chip text-muted" onClick={async () => onMsg(at ? said(await act({ action: "queue", id: c.id, at })) : "pick a time")}>Move</button>
            <button className="chip text-offline" onClick={async () => onMsg(said(await act({ action: "reject", id: c.id, note: note || "pulled from queue" })))}>Pull</button>
          </div>
        )}
        <div><span className="eyebrow">History</span>{c.history.slice(-6).reverse().map((h, i) => <div key={i} className="text-muted text-[11px]">{h.at.slice(5, 16)} {h.from ?? "·"} → {h.to} · {h.by}{h.note ? ` · ${h.note}` : ""}</div>)}</div>
      </div>
    </div>
  );
}

function FormatCard({ k, f }: { k: string; f: FormatReport }) {
  return (
    <Panel title={FORMATS[k] ?? k} sub={`${f.published} published · ${f.withMetrics} with metrics · ${f.planned} planned`}>
      <div className={`text-[16px] ${VERDICT[f.verdict] ?? "text-muted"}`}>{f.verdict}</div>
      <div className="text-muted text-[11px] mb-2">{f.why}</div>
      <table className="w-full text-[12px]"><tbody>
        <tr><td className="text-muted">median views</td><td className="text-ink text-right">{fmt(f.medianViews)}</td></tr>
        <tr><td className="text-muted">median avg % viewed</td><td className="text-ink text-right">{f.medianRetention === null ? "—" : `${fmt(f.medianRetention, 1)}%`}</td></tr>
        <tr><td className="text-muted">share rate</td><td className="text-ink text-right">{pct(f.shareRate)}</td></tr>
        <tr><td className="text-muted">follows / 1k views</td><td className="text-ink text-right">{fmt(f.followsPer1k, 1)}</td></tr>
        <tr><td className="text-muted">best post</td><td className="text-ink text-right truncate max-w-[160px]">{f.best ?? "—"}</td></tr>
        <tr><td className="text-muted">provenance</td><td className="text-ink text-right">{f.provenance.join(", ") || "no metrics"}</td></tr>
      </tbody></table>
      <div className="text-muted text-[10px] mt-1">{Object.entries(f.byStage).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(" · ")}</div>
    </Panel>
  );
}

export default function ContentOS() {
  const { data } = usePolling<ContentPayload>("/api/content", 2500);
  const [view, setView] = useState<View>("pipeline");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const session = useApprovalSession();
  if (!data) return <div className="text-muted text-[12px] p-4">loading…</div>;
  const rep = data.report;
  const items = data.items;
  const sel = items.find((c) => c.id === open) ?? null;
  const waiting = items.filter((c) => c.status === "APPROVAL");
  const queued = items.filter((c) => c.status === "QUEUE").sort((a, b) => (a.schedule.publishAt ?? "").localeCompare(b.schedule.publishAt ?? ""));
  const row = (c: ContentItem) => (
    <button key={c.id} onClick={() => setOpen(open === c.id ? null : c.id)} className={`w-full text-left border rounded p-2 mb-2 text-[12px] ${open === c.id ? "border-accent" : "border-line"}`}>
      <div className="text-ink truncate">{c.title}</div>
      <div className="text-muted text-[10px]">{c.format} · {c.kind}{c.errors.length && (!c.render.finishedAt || c.errors[c.errors.length - 1].at > c.render.finishedAt) ? " · ⚠" : ""}{c.status === "QUEUE" && c.schedule.publishAt ? ` · ${c.schedule.publishAt.slice(5, 16)}` : ""}</div>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-3"><img src="/tidefable/lockup-foam.svg" alt="Tidefable" className="h-8" /><span className="text-[13px] tracking-[0.14em] text-muted">CONTENT OS</span></span>
        <nav className="flex flex-wrap gap-1 ml-2">{VIEWS.map((v) => <button key={v} onClick={() => setView(v)} className={`chip ${view === v ? "text-online" : "text-muted"}`}>{v.toUpperCase()}{v === "approval" && waiting.length ? ` ${waiting.length}` : ""}</button>)}</nav>
        <span className="ml-auto flex items-center gap-2">
          {rep?.paused ? <span className="chip text-offline">PUBLISHING PAUSED</span> : <span className="chip text-online">publishing armed (approved items only)</span>}
          <button className="chip text-muted" onClick={async () => setMsg(said(await act({ action: "pause", on: !rep?.paused })))}>{rep?.paused ? "Resume" : "Emergency pause"}</button>
          {msg && <span className="text-muted text-[11px]">{msg}</span>}
        </span>
      </div>

      {view === "pipeline" && (
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-2">
          {STAGES.map((st) => (
            <div key={st} className="panel p-2 min-h-[160px]"><div className="eyebrow mb-2">{st} <span className="text-muted">{items.filter((c) => c.status === st).length || ""}</span></div>{items.filter((c) => c.status === st).map(row)}</div>
          ))}
        </div>
      )}
      {view === "approval" && <Panel title="Waiting for your approval" sub="QA passed · nothing here publishes until you click Approve">{waiting.length === 0 ? <div className="text-muted">nothing waiting</div> : waiting.map(row)}</Panel>}
      {view === "queue" && (
        <Panel title="Publish queue" sub="approved · the worker publishes at the time shown, only on CONNECTED platforms">
          {queued.length === 0 ? <div className="text-muted">queue is empty</div> : queued.map((c) => <div key={c.id} className="flex gap-3 items-center py-1 text-[12px]"><span className="text-muted tabular-nums">{c.schedule.publishAt}</span><span className="text-ink flex-1 truncate cursor-pointer" onClick={() => setOpen(c.id)}>{c.title}</span><span className="text-muted">{c.platformTargets.join(" + ")}</span>{Object.entries(c.publish).map(([k, p]) => p.status !== "none" && <span key={k} className={`chip ${p.status === "published" ? "text-online" : p.status === "error" ? "text-offline" : "text-muted"}`}>{k}: {p.status}</span>)}</div>)}
          {rep?.errors.length ? <div className="mt-3"><div className="eyebrow">Errors / retries</div>{rep.errors.map((e) => <div key={e.id + e.at} className="text-offline text-[12px]">{e.at.slice(5, 16)} · {e.title} · {e.stage}: {e.message}</div>)}</div> : null}
        </Panel>
      )}
      {view === "experiments" && rep && (<>
        <div className="text-muted text-[11px] px-1">4 formats × {rep.experiment.perFormat} vertical posts + {rep.experiment.longPerFormat} long-form each, {rep.experiment.days} days. Verdicts follow the research rules (retention rank + share rate + views vs median); observations only, no invented scores. Metrics arrive from the platform APIs once connected, or are entered manually with provenance "manual".</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">{Object.entries(rep.formats).map(([k, f]) => <FormatCard key={k} k={k} f={f} />)}</div>
        <Panel title="Published items" sub="per platform, latest metrics">
          {items.filter((c) => c.status === "PUBLISHED" || c.status === "ANALYTICS").length === 0 ? <div className="text-muted">nothing published yet</div> : (
            <table className="w-full text-[12px]"><thead><tr className="text-muted text-left"><th scope="col">title</th><th scope="col">format</th><th scope="col">platform</th><th scope="col">views</th><th scope="col">avg % viewed</th><th scope="col">shares</th><th scope="col">follows</th><th scope="col">provenance</th><th scope="col">url</th></tr></thead><tbody>
              {items.filter((c) => c.status === "PUBLISHED" || c.status === "ANALYTICS").flatMap((c) => {
                const latest: Record<string, (typeof c.metrics)[number]> = {}; for (const m of c.metrics) latest[m.platform] = m;
                const rows = Object.values(latest); if (rows.length === 0) rows.push({ platform: "—", at: "", provenance: "no metrics yet" });
                return rows.map((m) => <tr key={c.id + m.platform} className="border-t border-line"><td className="text-ink truncate max-w-[220px]">{c.title}</td><td className="text-muted">{c.format}</td><td className="text-muted">{m.platform}</td><td>{fmt(m.views)}</td><td>{m.avgPctViewed === undefined ? "—" : `${fmt(m.avgPctViewed, 1)}%`}</td><td>{fmt(m.shares)}</td><td>{fmt(m.follows)}</td><td className="text-muted">{m.provenance}</td><td>{Object.values(c.publish).filter((p) => p.url).map((p) => <a key={p.url} className="text-accent mr-2" href={p.url} target="_blank" rel="noreferrer">link</a>)}</td></tr>);
              })}
            </tbody></table>
          )}
        </Panel>
      </>)}
      {view === "platforms" && rep && <Panel title="Platform connections" sub="CONNECTED only after a verified live API call; tokens never leave the secrets folder">{rep.platforms.map((p) => <div key={p.name} className="flex gap-3 py-1 text-[12px]"><span className="text-ink w-72">{p.label}</span><span className={`chip ${p.state === "CONNECTED" ? "text-online" : p.state === "ERROR" ? "text-offline" : "text-muted"}`}>{p.state}</span><span className="text-muted">{p.note}</span></div>)}</Panel>}
      {view === "readiness" && rep && (
        <Panel title="Tidefable launch readiness" sub="explicit states from real sources: files on disk, verified tokens, the store, and flags you set after doing a manual step">
          {(rep.launch?.items ?? []).map((i) => (
            <div key={i.key} className={`flex gap-3 py-1.5 text-[12px] border-b border-line ${i.key === "ready" ? "text-[14px] mt-2" : ""}`}>
              <span className="text-ink w-80 shrink-0">{i.label}{i.required ? "" : <span className="text-muted"> (optional)</span>}</span>
              <span className={`chip ${STATE_CLASS[i.state] ?? "text-muted"}`}>{i.state}</span>
              <span className="text-muted">{i.detail}</span>
            </div>
          ))}
          <div className="text-muted text-[11px] mt-3">Manual steps are recorded with <code>content_os.py launch-flag &lt;key&gt; on --note "…"</code> after you do them (keys: auditSubmitted, auditPassed, thumbnailsVerified, syntheticMediaVerified, oauthProduction). Nothing flips to DONE on its own.</div>
        </Panel>
      )}
      {view === "history" && <Panel title="Content history" sub="audit log, content actions only">{data.audit.slice().reverse().map((a) => <div key={a.id} className="flex gap-3 text-[12px]"><span className="text-muted tabular-nums shrink-0">{a.at.slice(5, 16)}</span><span className="text-muted">{a.actor}</span><span className="text-ink truncate">{a.action.replace("content_", "")}: {a.result}</span>{a.approval !== "n/a" && <span className="chip text-muted">{a.approval}</span>}</div>)}{data.audit.length === 0 && <div className="text-muted">nothing yet</div>}</Panel>}

      {sel && <Panel title={sel.title} sub={`${sel.id} · ${sel.status}`}><Detail key={sel.id} c={sel} onMsg={setMsg} session={session} /></Panel>}
    </div>
  );
}
