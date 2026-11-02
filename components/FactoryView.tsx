"use client";

import { useState } from "react";
import { usePolling, timeAgo } from "./usePolling";
import SignInToApprove from "./SignInToApprove";
import { approvalHeaders, useApprovalSession, type ApprovalSession } from "./useApprovalSession";

/* ---- types: mirror voice-line/factory.py project records (logs/factory.json) ---- */
export type FactoryState = "INTAKE" | "AWAITING_PLAN_APPROVAL" | "BUILDING" | "CRITIQUE" | "REVISION" | "VERIFYING" | "REVIEW_READY" | "AWAITING_DEPLOYMENT" | "FAILED" | "BLOCKED" | "CANCELLED" | string;
export type StageStatus = "pending" | "waiting" | "running" | "done" | "failed" | "not_run" | "cancelled" | string;
export interface Stage { status: StageStatus; at?: string; note?: string; error?: string; taskId?: string; questions?: string[]; count?: number; [k: string]: unknown }
export interface Brief { business_name?: string; industry?: string; target_customers?: string; services?: ({ name: string; description?: string } | string)[]; primary_cta?: { label: string; kind: string }; pages?: string[]; contact?: { phone?: string; email?: string; address?: string; hours?: string }; visual_direction?: string; [k: string]: unknown }
export interface Plan { sitemap: string[]; journeys?: string[]; acceptance: string[]; stages?: string[]; agents?: Record<string, string>; skills: string[]; skillsMissing: string[]; stack: string; hosting?: string }
export interface GateFinding { id: string; category?: string; severity: string; status: string; title: string; evidence?: string[]; remediation?: string }
export interface Gate { status: string; counts: Record<string, number>; blocking: string[]; findings: GateFinding[] }
export interface A11yFinding { rule?: string; page?: string; wcag?: string; description?: string; severity?: string; [k: string]: unknown }
export interface A11y { automated: A11yFinding[] | null; manual: unknown[] | null; bySeverity: Record<string, number> | null; material: boolean | null; blindSpots?: string[] | null; error?: string | null }
export interface ReviewPackage { siteDir: string; siteHash: string; pages?: unknown; preview: string; tests: { status: string; summary?: string; note?: string }; gate?: { status: string; counts: Record<string, number>; open: string[] }; a11y?: { bySeverity: Record<string, number>; manualPending: number }; flags?: string[]; limitations: string[]; deployment: string }
export interface FactoryProject { planHash?: string | null;
  id: string; createdAt: string; updatedAt?: string; createdBy?: string; state: FactoryState; stage: string; brief: Brief; briefHash?: string;
  questions: string[]; flags: string[]; plan: Plan | null; stages: Record<string, Stage>; tasks: string[];
  findings: { gate: Gate | null; a11y: A11y | null }; revisions: number; approvals: { plan: { by: string; at: string; planHash: string } | null; deploy: { by: string; at: string; siteHash?: string } | null };
  reviewPackage: ReviewPackage | null; error: string | null; events: { at: string; what: string }[]; siteDir: string;
}
interface Payload { projects: FactoryProject[] }
interface ApiResult { status: number; body: Record<string, unknown> }

const TERMINAL = ["REVIEW_READY", "AWAITING_DEPLOYMENT", "FAILED", "BLOCKED", "CANCELLED"];
const RUNNABLE = ["BUILDING", "CRITIQUE", "REVISION", "VERIFYING"];
const STAGE_ORDER = ["intake", "research", "architecture", "design", "implementation", "critique", "revision", "verification", "approval"];
const BRIEF_KEYS = ["business_name", "industry", "target_customers", "services", "primary_cta", "pages", "visual_direction"] as const;
type BriefKey = (typeof BRIEF_KEYS)[number];

function stateBadge(s: string): string {
  if (s === "REVIEW_READY" || s === "AWAITING_DEPLOYMENT") return "badge--ok";
  if (s === "FAILED" || s === "BLOCKED") return "badge--bad";
  if (s === "INTAKE" || s === "AWAITING_PLAN_APPROVAL") return "badge--warn";
  if (RUNNABLE.includes(s)) return "badge--accent";
  return "";
}
function stageBadge(s: StageStatus): string {
  if (s === "done") return "badge--ok";
  if (s === "failed") return "badge--bad";
  if (s === "running") return "badge--accent";
  if (s === "waiting") return "badge--warn";
  return "";
}
function stageDot(s: StageStatus): string {
  if (s === "done") return "timeline__item--ok";
  if (s === "failed" || s === "cancelled") return "timeline__item--bad";
  if (s === "running" || s === "waiting") return "timeline__item--live";
  return "";
}
function sevBadge(s: string | undefined): string {
  if (s === "critical" || s === "high" || s === "serious") return "badge--bad";
  if (s === "medium" || s === "moderate") return "badge--warn";
  return "";
}
function inferKey(q: string): BriefKey {
  const t = q.toLowerCase();
  if (t.includes("called")) return "business_name";
  if (t.includes("industry")) return "industry";
  if (t.includes("customers")) return "target_customers";
  if (t.includes("service")) return "services";
  if (t.includes("action") || t.includes("button")) return "primary_cta";
  return "visual_direction";
}
function parseServices(text: string): { name: string; description: string }[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [name, ...rest] = l.split(/\s[—–-]\s|\s*—\s*/); return { name: name.trim(), description: rest.join(" ").trim() }; });
}
function describe(r: ApiResult): string { return `HTTP ${r.status} · ${JSON.stringify(r.body)}`; }

/** An approval (approve-plan, approve-deploy-first, approve-deploy) must carry the session-bound X-CSRF; the server refuses it otherwise (G9-2). */
async function post(body: Record<string, unknown>, csrf?: string | null): Promise<ApiResult> {
  const r = await fetch("/api/factory", { method: "POST", headers: approvalHeaders(csrf), body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({ ok: false, error: `non-JSON response (${r.status})` }))) as Record<string, unknown>;
  return { status: r.status, body: j };
}

/** Wraps a POST: disables the caller while in flight, reports the verbatim result (success or 400/409 error) and returns it. */
function useAction(refresh: () => void, csrf?: string | null) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function act(label: string, body: Record<string, unknown>): Promise<ApiResult | null> {
    setBusy(label); setMsg(null);
    let r: ApiResult | null = null;
    try { r = await post(body, csrf); setMsg(`${label}: ${describe(r)}`); } catch (e) { setMsg(`${label}: ${e instanceof Error ? e.message : "request failed"}`); }
    setBusy(null); refresh();
    return r;
  }
  return { busy, msg, act };
}

/* Module-level so inputs keep identity (and focus) across StartForm re-renders. */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label htmlFor={id} className="text-[11px] text-muted">{label}</label>{children}</div>;
}

/* ---- left column: start a website ---- */
function StartForm({ refresh }: { refresh: () => void }) {
  const [f, setF] = useState({ business_name: "", industry: "", target_customers: "", services: "", cta_label: "", cta_kind: "call", pages: "home, services, contact", phone: "", email: "", address: "", hours: "", visual_direction: "" });
  const { busy, msg, act } = useAction(refresh);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const contact: Record<string, string> = {};
    for (const k of ["phone", "email", "address", "hours"] as const) if (f[k].trim()) contact[k] = f[k].trim();
    const brief: Brief = {
      business_name: f.business_name.trim(), industry: f.industry.trim(), target_customers: f.target_customers.trim(), services: parseServices(f.services),
      primary_cta: f.cta_label.trim() ? { label: f.cta_label.trim(), kind: f.cta_kind } : undefined,
      pages: f.pages.split(",").map((s) => s.trim()).filter(Boolean), contact, visual_direction: f.visual_direction.trim() || undefined,
    };
    void act("start", { action: "start", brief });
  }
  return (
    <section className="panel">
      <div className="panel__head"><span className="eyebrow">Start a website</span><span className="text-muted text-[11px]">brief → questions → plan approval → build → review</span></div>
      <form onSubmit={submit} className="px-4 py-3 flex flex-col gap-2 text-[12px]">
        <Field id="f-name" label="Business name"><input id="f-name" className="input" value={f.business_name} onChange={set("business_name")} required /></Field>
        <Field id="f-industry" label="Industry or trade"><input id="f-industry" className="input" value={f.industry} onChange={set("industry")} required /></Field>
        <Field id="f-customers" label="Target customers"><input id="f-customers" className="input" value={f.target_customers} onChange={set("target_customers")} required /></Field>
        <Field id="f-services" label="Services — one per line as “Name — description”"><textarea id="f-services" className="input" rows={4} value={f.services} onChange={set("services")} placeholder={"Roof repair — same-week leak fixes\nGutter cleaning — twice-yearly service"} /></Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field id="f-cta" label="Primary call to action (button label)"><input id="f-cta" className="input" value={f.cta_label} onChange={set("cta_label")} placeholder="Call us today" /></Field>
          <Field id="f-cta-kind" label="Kind"><select id="f-cta-kind" className="input" value={f.cta_kind} onChange={set("cta_kind")}>{["call", "book", "form", "email"].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
        </div>
        <Field id="f-pages" label="Pages (comma separated; privacy, terms, accessibility are always added)"><input id="f-pages" className="input" value={f.pages} onChange={set("pages")} /></Field>
        <fieldset className="border border-line rounded p-2 flex flex-col gap-2">
          <legend className="text-[11px] text-muted px-1">Contact (optional). Anything left blank becomes a flagged “contact details pending” placeholder on the site — nothing is invented.</legend>
          <div className="grid grid-cols-2 gap-2">
            <Field id="f-phone" label="Phone"><input id="f-phone" className="input" value={f.phone} onChange={set("phone")} placeholder="missing → placeholder" /></Field>
            <Field id="f-email" label="Email"><input id="f-email" className="input" value={f.email} onChange={set("email")} placeholder="missing → placeholder" /></Field>
          </div>
          <Field id="f-address" label="Address"><input id="f-address" className="input" value={f.address} onChange={set("address")} placeholder="missing → placeholder" /></Field>
          <Field id="f-hours" label="Hours"><input id="f-hours" className="input" value={f.hours} onChange={set("hours")} placeholder="missing → placeholder" /></Field>
        </fieldset>
        <Field id="f-visual" label="Visual direction (optional)"><input id="f-visual" className="input" value={f.visual_direction} onChange={set("visual_direction")} placeholder="e.g. calm, navy and sand, large type" /></Field>
        <div className="flex items-center gap-2 mt-1">
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy !== null}>{busy ? "Starting…" : "Start project"}</button>
          <span className="text-muted text-[11px]">POST /api/factory {"{action:\"start\"}"} → factory.py validates and asks for anything missing.</span>
        </div>
        <div className="text-[11px] break-words" role="status" aria-live="polite">{msg && <code>{msg}</code>}</div>
      </form>
    </section>
  );
}

/* ---- answer form for open questions ---- */
function AnswerForm({ p, refresh }: { p: FactoryProject; refresh: () => void }) {
  const [keys, setKeys] = useState<Record<number, BriefKey>>({});
  const [vals, setVals] = useState<Record<number, string>>({});
  const [kind, setKind] = useState("call");
  const { busy, msg, act } = useAction(refresh);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const updates: Record<string, unknown> = {};
    p.questions.forEach((q, i) => {
      const k = keys[i] ?? inferKey(q); const v = (vals[i] ?? "").trim();
      if (!v) return;
      if (k === "services") updates.services = parseServices(v);
      else if (k === "primary_cta") updates.primary_cta = { label: v, kind };
      else if (k === "pages") updates.pages = v.split(",").map((s) => s.trim()).filter(Boolean);
      else updates[k] = v;
    });
    void act("answer", { action: "answer", project: p.id, answers: updates });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {p.questions.map((q, i) => {
        const k = keys[i] ?? inferKey(q);
        return (
          <div key={i} className="border border-line rounded p-2 flex flex-col gap-1">
            <label htmlFor={`q-${p.id}-${i}`} className="text-ink">{q}</label>
            <div className="flex gap-2 flex-wrap">
              <select aria-label={`Brief field for question ${i + 1}`} className="input" style={{ width: "auto" }} value={k} onChange={(e) => setKeys({ ...keys, [i]: e.target.value as BriefKey })}>{BRIEF_KEYS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
              {k === "primary_cta" && <select aria-label="Call-to-action kind" className="input" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)}>{["call", "book", "form", "email"].map((x) => <option key={x} value={x}>{x}</option>)}</select>}
            </div>
            {k === "services" ? <textarea id={`q-${p.id}-${i}`} className="input" rows={3} value={vals[i] ?? ""} onChange={(e) => setVals({ ...vals, [i]: e.target.value })} placeholder="one per line: Name — description" />
              : <input id={`q-${p.id}-${i}`} className="input" value={vals[i] ?? ""} onChange={(e) => setVals({ ...vals, [i]: e.target.value })} />}
          </div>
        );
      })}
      <div className="flex items-center gap-2"><button type="submit" className="btn btn--primary btn--sm" disabled={busy !== null}>{busy ? "Sending…" : "Send answers"}</button></div>
      <div className="text-[11px] break-words" role="status" aria-live="polite">{msg && <code>{msg}</code>}</div>
    </form>
  );
}

/* ---- right column: one project ---- */
function ProjectDetail({ p, refresh, session }: { p: FactoryProject; refresh: () => void; session: ApprovalSession }) {
  const { busy, msg, act } = useAction(refresh, session.csrf);
  // Roy's TWO tier: the nonce from click 1 lives here, for THIS project and site hash only, until click 2 succeeds.
  const [first, setFirst] = useState<{ project: string; siteHash: string; nonce: string } | null>(null);
  const gate = p.findings?.gate ?? null; const a11y = p.findings?.a11y ?? null; const rp = p.reviewPackage;
  const openFindings = (gate?.findings ?? []).filter((f) => ["failed", "needs_manual_review", "not_run"].includes(f.status));
  const stageNames = [...STAGE_ORDER, ...Object.keys(p.stages ?? {}).filter((s) => !STAGE_ORDER.includes(s))];
  const terminal = TERMINAL.includes(p.state);
  const siteHash = typeof rp?.siteHash === "string" && /^[a-f0-9]{12,64}$/.test(rp.siteHash) ? rp.siteHash : null;
  const signedIn = session.state === "signed-in";
  const firstDone = !!first && !!siteHash && first.project === p.id && first.siteHash === siteHash;
  async function approveOrRefresh(label: string, body: Record<string, unknown>): Promise<ApiResult | null> {
    const r = await act(label, body);
    if (r && (r.status === 401 || r.status === 403)) session.refresh();   // the session ended: the buttons give way to "Sign in to approve"
    return r;
  }
  async function deployFirst() {
    if (!siteHash) return;
    const r = await approveOrRefresh("approve-deploy-first", { action: "approve-deploy-first", project: p.id, siteHash });
    const nonce = r && r.status === 200 && r.body.ok === true && typeof r.body.nonce === "string" ? r.body.nonce : null;
    setFirst(nonce ? { project: p.id, siteHash, nonce } : null);
  }
  async function deploySecond() {
    if (!firstDone || !siteHash || !first) return;
    const r = await approveOrRefresh("approve-deploy", { action: "approve-deploy", project: p.id, siteHash, nonce: first.nonce });
    if (r && r.status === 200 && r.body.ok === true) setFirst(null);
  }
  return (
    <div className="flex flex-col gap-3 text-[12px]">
      <section className="panel">
        <div className="panel__head">
          <span className="text-ink text-[13px]">{p.brief?.business_name || p.id}</span>
          <span className={`badge ${stateBadge(p.state)}`}>{p.state.replace(/_/g, " ")}</span>
          <span className="text-muted text-[11px]">stage · {p.stage} · revisions {p.revisions ?? 0}</span>
          <span className="ml-auto flex gap-2 flex-wrap items-center">
            {RUNNABLE.includes(p.state) && <button className="btn btn--primary btn--sm" disabled={busy !== null} onClick={() => void act("run", { action: "run", project: p.id })}>{busy === "run" ? "Running…" : "Run build"}</button>}
            {p.state === "REVIEW_READY" && !signedIn && <SignInToApprove session={session} next="/factory" small />}
            {p.state === "REVIEW_READY" && signedIn && !firstDone && <button className="btn btn--sm" disabled={busy !== null || !siteHash} onClick={() => void deployFirst()}>{busy === "approve-deploy-first" ? "Recording…" : "Approve deployment (1 of 2)"}</button>}
            {p.state === "REVIEW_READY" && signedIn && firstDone && <button className="btn btn--primary btn--sm" disabled={busy !== null} onClick={() => void deploySecond()}>{busy === "approve-deploy" ? "Approving…" : "Confirm deployment (2 of 2)"}</button>}
            {!terminal && <button className="btn btn--danger btn--sm" disabled={busy !== null} onClick={() => void act("cancel", { action: "cancel", project: p.id })}>{busy === "cancel" ? "Cancelling…" : "Cancel"}</button>}
          </span>
        </div>
        <div className="px-4 py-2 flex flex-col gap-1">
          <dl className="hud__dl">
            <dt>Id</dt><dd><code>{p.id}</code> · created {timeAgo(p.createdAt)}{p.createdBy ? ` by ${p.createdBy}` : ""}</dd>
            <dt>Site dir</dt><dd><code className="break-all">{p.siteDir}</code></dd>
            {p.error && <><dt>Error</dt><dd className="text-offline">{p.error}</dd></>}
            {p.approvals?.plan && <><dt>Plan</dt><dd>approved by {p.approvals.plan.by} · {timeAgo(p.approvals.plan.at)} · hash {p.approvals.plan.planHash}</dd></>}
            {p.approvals?.deploy && <><dt>Deploy</dt><dd>approved by {p.approvals.deploy.by} · {timeAgo(p.approvals.deploy.at)} · site {(p.approvals.deploy.siteHash ?? "").slice(0, 12)}</dd></>}
          </dl>
          {p.state === "REVIEW_READY" && signedIn && <div className="text-[11px] text-muted" role="status">{firstDone ? `1 of 2 recorded for site ${siteHash?.slice(0, 12)} · confirm at least 2 s and at most 5 min later` : siteHash ? `Deploying takes two separate clicks: 1 of 2, then 2 of 2 (2 s – 5 min later), both for site ${siteHash.slice(0, 12)}` : "No reviewed site hash yet; nothing can be approved."}</div>}
          <div className="text-[11px] break-words" role="status" aria-live="polite">{msg && <code>{msg}</code>}</div>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel">
          <div className="panel__head"><span className="eyebrow">Stages</span></div>
          <ol className="timeline px-4 py-3 m-0 list-none">
            {stageNames.map((s) => { const st = p.stages?.[s] ?? { status: "pending" }; return (
              <li key={s} className={`timeline__item ${stageDot(st.status)}`}>
                <span className="text-ink">{s}</span> <span className={`badge ${stageBadge(st.status)}`}>{st.status.replace(/_/g, " ")}</span>
                {st.at && <span className="text-muted text-[11px]"> · {timeAgo(st.at)}</span>}
                {st.taskId && <span className="text-muted text-[11px]"> · task {st.taskId}</span>}
                {st.note && <div className="text-muted text-[11px]">{st.note}</div>}
                {st.error && <div className="text-offline text-[11px]">{st.error}</div>}
              </li>); })}
          </ol>
        </section>

        <section className="panel">
          <div className="panel__head"><span className="eyebrow">Brief</span>{p.flags?.length > 0 && <span className="badge badge--warn">{p.flags.length} flag{p.flags.length === 1 ? "" : "s"}</span>}</div>
          <div className="px-4 py-3">
            <dl className="hud__dl">
              <dt>Industry</dt><dd>{p.brief?.industry || "—"}</dd>
              <dt>Customers</dt><dd>{p.brief?.target_customers || "—"}</dd>
              <dt>Services</dt><dd>{(p.brief?.services ?? []).map((s) => typeof s === "string" ? s : s.description ? `${s.name} — ${s.description}` : s.name).join("; ") || "—"}</dd>
              <dt>CTA</dt><dd>{p.brief?.primary_cta ? `${p.brief.primary_cta.label} (${p.brief.primary_cta.kind})` : "—"}</dd>
              <dt>Pages</dt><dd>{(p.brief?.pages ?? []).join(", ") || "default"}</dd>
            </dl>
            {p.flags?.length > 0 && <ul className="mt-2 list-disc pl-4 text-[11px] text-warn">{p.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          </div>
        </section>
      </div>

      {p.questions?.length > 0 && (
        <section className="panel">
          <div className="panel__head"><span className="eyebrow">Open questions</span><span className="badge badge--warn">{p.questions.length}</span><span className="text-muted text-[11px]">answers merge into the brief; the plan is produced once nothing is missing</span></div>
          <div className="px-4 py-3">{terminal ? <ul className="list-disc pl-4">{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ul> : <AnswerForm p={p} refresh={refresh} />}</div>
        </section>
      )}

      {p.plan && (
        <section className="panel">
          <div className="panel__head">
            <span className="eyebrow">Plan</span>
            {p.state === "AWAITING_PLAN_APPROVAL" && <span className="ml-auto">{signedIn ? <button className="btn btn--primary btn--sm" disabled={busy !== null} onClick={() => void approveOrRefresh("approve-plan", { action: "approve-plan", project: p.id, planHash: p.planHash })}>{busy === "approve-plan" ? "Approving…" : `Approve this plan (${p.planHash ?? "no hash"})`}</button> : <SignInToApprove session={session} next="/factory" small />}</span>}
          </div>
          <div className="px-4 py-3">
            <dl className="hud__dl">
              <dt>Sitemap</dt><dd>{p.plan.sitemap.join(" · ")}</dd>
              {p.plan.journeys && <><dt>Journeys</dt><dd><ul className="list-disc pl-4">{p.plan.journeys.map((j, i) => <li key={i}>{j}</li>)}</ul></dd></>}
              <dt>Acceptance</dt><dd><ul className="list-disc pl-4">{p.plan.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul></dd>
              <dt>Skills</dt><dd>{p.plan.skills.length ? p.plan.skills.join(", ") : <span className="text-muted">none selected</span>}</dd>
              <dt>Missing</dt><dd>{p.plan.skillsMissing.length ? <span className="text-warn">{p.plan.skillsMissing.join(", ")}</span> : <span className="text-muted">none</span>}</dd>
              <dt>Stack</dt><dd>{p.plan.stack}</dd>
              {p.plan.hosting && <><dt>Hosting</dt><dd>{p.plan.hosting}</dd></>}
            </dl>
          </div>
        </section>
      )}

      {(gate || a11y) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="panel">
            <div className="panel__head"><span className="eyebrow">Security gate</span>{gate && <span className={`badge ${gate.status === "ready" ? "badge--ok" : "badge--bad"}`}>{gate.status}</span>}</div>
            <div className="px-4 py-3">
              {gate ? (<>
                <div className="flex flex-wrap gap-1 mb-2">{Object.entries(gate.counts ?? {}).map(([k, v]) => <span key={k} className="badge">{k.replace(/_/g, " ")} · {v}</span>)}</div>
                {gate.blocking?.length > 0 && <div className="text-offline text-[11px] mb-2">blocking: {gate.blocking.join(", ")}</div>}
                {openFindings.length > 0 ? (
                  <div className="overflow-auto"><table className="table"><thead><tr><th scope="col">Severity</th><th scope="col">Id</th><th scope="col">Title</th><th scope="col">Evidence</th></tr></thead>
                    <tbody>{openFindings.map((f) => <tr key={f.id}><td><span className={`badge ${sevBadge(f.severity)}`}>{f.severity}</span><div className="text-muted text-[10px]">{f.status.replace(/_/g, " ")}</div></td><td><code className="text-[11px]">{f.id}</code></td><td>{f.title}</td><td className="text-muted text-[11px]">{f.evidence?.[0] ?? "—"}</td></tr>)}</tbody></table></div>
                ) : <div className="text-muted">No failed, manual-review or not-run checks.</div>}
              </>) : <div className="text-muted">Gate has not run yet.</div>}
            </div>
          </section>
          <section className="panel">
            <div className="panel__head"><span className="eyebrow">Accessibility</span>{a11y && <span className={`badge ${a11y.material ? "badge--bad" : a11y.error ? "badge--warn" : "badge--ok"}`}>{a11y.error ? "unavailable" : a11y.material ? "material" : "no material finding"}</span>}</div>
            <div className="px-4 py-3">
              {a11y ? (<>
                {a11y.error && <div className="text-warn text-[11px] mb-2">{a11y.error}</div>}
                <div className="flex flex-wrap gap-1 mb-2">{Object.entries(a11y.bySeverity ?? {}).map(([k, v]) => <span key={k} className={`badge ${sevBadge(k)}`}>{k} · {v}</span>)}<span className="badge">manual pending · {a11y.manual?.length ?? 0}</span></div>
                {(a11y.automated ?? []).length > 0 ? <ul className="list-disc pl-4 text-[11px]">{(a11y.automated ?? []).map((f, i) => <li key={i}><span className="text-ink">{f.rule ?? "rule"}</span>{f.page ? ` · ${f.page}` : ""}{f.wcag ? ` · WCAG ${f.wcag}` : ""}{f.description ? ` — ${f.description}` : ""}</li>)}</ul> : <div className="text-muted">No automated findings.</div>}
                {(a11y.blindSpots ?? []).length > 0 && <details className="mt-2"><summary className="text-muted cursor-pointer text-[11px]">blind spots (not checked automatically)</summary><ul className="list-disc pl-4 text-[11px] mt-1">{(a11y.blindSpots ?? []).map((b, i) => <li key={i}>{b}</li>)}</ul></details>}
              </>) : <div className="text-muted">Audit has not run yet.</div>}
            </div>
          </section>
        </div>
      )}

      {rp && (
        <section className="panel">
          <div className="panel__head"><span className="eyebrow">Review package</span><span className="text-muted text-[11px]">site {rp.siteHash.slice(0, 12)}</span></div>
          <div className="px-4 py-3 flex flex-col gap-2">
            <dl className="hud__dl">
              <dt>Site dir</dt><dd><code className="break-all">{rp.siteDir}</code></dd>
              <dt>Preview</dt><dd><code className="block whitespace-pre-wrap break-all text-[11px] border border-line rounded p-2">{rp.preview}</code></dd>
              <dt>Tests</dt><dd><span className={`badge ${rp.tests.status === "passed" ? "badge--ok" : rp.tests.status === "failed" ? "badge--bad" : ""}`}>{rp.tests.status.replace(/_/g, " ")}</span>{rp.tests.note && <span className="text-muted"> · {rp.tests.note}</span>}{rp.tests.summary && <pre className="text-[11px] whitespace-pre-wrap mt-1">{rp.tests.summary}</pre>}</dd>
              <dt>Limitations</dt><dd><ul className="list-disc pl-4">{rp.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></dd>
              <dt>Deployment</dt><dd>{rp.deployment}</dd>
            </dl>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel__head"><span className="eyebrow">Events</span><span className="text-muted text-[11px]">{p.events?.length ?? 0}</span></div>
        <ol className="px-4 py-3 m-0 list-none flex flex-col gap-0.5 text-[11px]">
          {[...(p.events ?? [])].reverse().map((e, i) => <li key={i}><span className="text-muted">{e.at.slice(5, 19).replace("T", " ")}</span> <span className="text-ink">{e.what}</span></li>)}
          {(p.events?.length ?? 0) === 0 && <li className="text-muted">no events yet</li>}
        </ol>
      </section>
    </div>
  );
}

export default function FactoryView() {
  const { data, error, loading, refresh } = usePolling<Payload>("/api/factory", 3000);
  const [selected, setSelected] = useState<string | null>(null);
  const session = useApprovalSession();
  const projects = data?.projects ?? [];
  const current = projects.find((p) => p.id === selected) ?? projects[0] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head">
          <span className="eyebrow">Website factory</span>
          <span className="text-muted text-[11px]">{loading && !data ? "loading…" : `${projects.length} project${projects.length === 1 ? "" : "s"} · logs/factory.json · polled every 3 s`}</span>
          {error && <span className="ml-auto badge badge--bad" role="status">could not load: {error}</span>}
        </div>
      </section>
      <div className="grid gap-4 [@media(min-width:1000px)]:grid-cols-[minmax(320px,2fr)_3fr]">
        <div className="flex flex-col gap-4">
          <StartForm refresh={refresh} />
          <section className="panel">
            <div className="panel__head"><span className="eyebrow">Projects</span></div>
            <ul className="m-0 list-none px-2 py-2 flex flex-col gap-1 text-[12px]">
              {projects.map((p) => (
                <li key={p.id}>
                  <button className={`btn btn--sm w-full text-left flex items-center gap-2 ${current?.id === p.id ? "btn--primary" : ""}`} aria-pressed={current?.id === p.id} onClick={() => setSelected(p.id)}>
                    <span className="truncate">{p.brief?.business_name || p.id}</span>
                    <span className={`badge ml-auto ${stateBadge(p.state)}`}>{p.state.replace(/_/g, " ")}</span>
                  </button>
                </li>
              ))}
              {!loading && projects.length === 0 && <li className="text-muted px-2">No projects yet. Start one with the form above (or say “build me a website for…”).</li>}
            </ul>
          </section>
        </div>
        <div>{current ? <ProjectDetail key={current.id} p={current} refresh={refresh} session={session} /> : <section className="panel"><div className="px-4 py-3 text-[12px] text-muted">Select a project to see its stages, questions, plan, findings and review package.</div></section>}</div>
      </div>
    </div>
  );
}
