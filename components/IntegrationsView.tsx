"use client";

import { useState } from "react";
import { usePolling, timeAgo } from "./usePolling";

interface Connector { id: string; service: string; provider: string; kind: string; owner: string; operations: string[]; auth: string; scopes: string; capability: string; rate_limits: string; cost: string; secret_env: string[]; secret_store: string; timeouts: string; failure: string; approval: string; test: string; docs: string; notes?: string; status: string; running: boolean | null; note: string; verified?: boolean; checkedAt: string }
interface Skill { id: string; version: string; purpose: string; when: string; inputs: string; outputs: string; instructions: string; roles: string[]; dependencies: string[]; safety: string; validation: string }
interface CatalogAgent { id: string; name: string; status: string; dispatchable: boolean; responsibility: string; purpose: string; builtins: string[]; bash: string | null; jarvis_tools: string[]; write_roots: string[]; skills: string[]; connectors: string[]; timeout_s: number; max_turns: number; max_retries: number; approval_always: string[]; failure: string; validation: string; owner?: string }
interface Payload { registry: { version: string; checkedAt: string; connectors: Connector[]; skills: Skill[] } | null; catalog: { version: string; agents: CatalogAgent[] } | null; note: string }

const STATUS_HELP: Record<string, string> = {
  available: "installed/configured; not necessarily verified by a live call", not_installed: "no connector or server configured for Jarvis", not_authenticated: "needs a key or sign-in (name only; values never read)",
  needs_permission: "configured; needs an authorization step", read_only: "reads only", write_enabled: "may change external state (gated)", rate_limited: "quota exhausted", error: "the last check failed", disabled: "switched off by policy",
};

export default function IntegrationsView() {
  const { data, refresh } = usePolling<Payload>("/api/integrations", 20000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"connectors" | "skills" | "agents">("connectors");
  async function recheck() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/integrations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "recheck" }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false); setMsg(j.ok ? "Re-checked." : `Re-check failed: ${j.error ?? r.status}`); refresh();
  }
  const reg = data?.registry;
  const counts: Record<string, number> = {};
  for (const c of reg?.connectors ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head">
          <span className="eyebrow">Integrations</span>
          <span className="text-muted text-[11px]">{reg ? `registry ${reg.version} · probed ${timeAgo(reg.checkedAt)}` : data?.note ?? "loading…"}</span>
          <span className="ml-auto flex items-center gap-2">
            {msg && <span className="text-[11px] text-muted" role="status">{msg}</span>}
            <button className="btn btn--sm" onClick={() => void recheck()} disabled={busy}>{busy ? "Checking…" : "Re-check now"}</button>
          </span>
        </div>
        <div className="px-4 py-3 flex flex-wrap gap-2 text-[12px]">
          {Object.entries(counts).map(([k, v]) => <span key={k} className={`status-chip status-chip--${k}`} title={STATUS_HELP[k]}>{k.replace(/_/g, " ")} · {v}</span>)}
          <span className="text-muted ml-auto">A status comes from a real check; no secret value is ever read or shown.</span>
        </div>
        <div className="px-4 pb-3 flex gap-2">
          {(["connectors", "skills", "agents"] as const).map((t) => <button key={t} className={`btn btn--sm ${tab === t ? "btn--primary" : ""}`} onClick={() => setTab(t)} aria-pressed={tab === t}>{t}</button>)}
        </div>
      </section>

      {tab === "connectors" && (
        <section className="panel">
          <div className="px-2 py-2 overflow-auto">
            <table className="table">
              <thead><tr><th scope="col">Connector</th><th scope="col">Status</th><th scope="col">Capability</th><th scope="col">Auth · secrets</th><th scope="col">Approval</th><th scope="col">Cost · limits</th><th scope="col">Owner</th></tr></thead>
              <tbody>
                {(reg?.connectors ?? []).map((c) => (
                  <tr key={c.id}>
                    <td><div className="text-ink">{c.service}</div><div className="text-muted text-[11px]">{c.id} · {c.kind}{c.docs.startsWith("http") && <> · <a className="text-accent" href={c.docs} target="_blank" rel="noreferrer">docs</a></>}</div></td>
                    <td><span className={`status-chip status-chip--${c.status}`} title={STATUS_HELP[c.status]}>{c.status.replace(/_/g, " ")}</span>{c.running !== null && <div className="text-muted text-[11px]">{c.running ? "running" : "not running"}</div>}<div className="text-muted text-[11px] max-w-[26ch]">{c.note}</div></td>
                    <td className="text-[11.5px]">{c.capability}<div className="text-muted">{c.operations.join("; ")}</div></td>
                    <td className="text-[11.5px]">{c.auth}<div className="text-muted">{c.secret_env.length ? `${c.secret_env.join(", ")} in ${c.secret_store}` : "no secret"}</div></td>
                    <td className="text-[11.5px]">{c.approval}</td>
                    <td className="text-[11.5px]">{c.cost}<div className="text-muted">{c.rate_limits}</div>{c.notes && <div className="text-muted">{c.notes}</div>}</td>
                    <td className="text-[11.5px]">{c.owner}</td>
                  </tr>
                ))}
                {!reg && <tr><td colSpan={7} className="text-muted">No snapshot yet. Start the voice line (it writes logs/integrations.json) or press Re-check.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "skills" && (
        <section className="panel"><div className="px-4 py-3 grid gap-3 md:grid-cols-2">
          {(reg?.skills ?? []).map((s) => (
            <div key={s.id} className="border border-line rounded p-3 text-[12px]">
              <div className="text-ink">{s.id} <span className="text-muted">v{s.version}</span></div>
              <div className="text-muted">{s.purpose}</div>
              <dl className="hud__dl mt-1"><dt>When</dt><dd>{s.when}</dd><dt>Roles</dt><dd>{s.roles.join(", ")}</dd><dt>Outputs</dt><dd>{s.outputs}</dd><dt>Safety</dt><dd>{s.safety}</dd><dt>Validation</dt><dd>{s.validation}</dd></dl>
              <details className="mt-1"><summary className="text-muted cursor-pointer">instructions</summary><div className="mt-1">{s.instructions}</div></details>
            </div>
          ))}
        </div></section>
      )}

      {tab === "agents" && (
        <section className="panel"><div className="px-4 py-3 grid gap-3 md:grid-cols-2">
          {(data?.catalog?.agents ?? []).map((a) => (
            <div key={a.id} className="border border-line rounded p-3 text-[12px]">
              <div className="flex items-center gap-2"><span className="text-ink">{a.name}</span><span className={`badge ${a.status === "operational" ? "badge--ok" : a.status === "planned" ? "" : "badge--accent"}`}>{a.status}</span>{!a.dispatchable && <span className="text-muted text-[11px]">not dispatchable</span>}</div>
              <div className="text-muted">{a.responsibility}</div>
              <dl className="hud__dl mt-1">
                <dt>Tools</dt><dd>{[...a.builtins, ...a.jarvis_tools.map((t) => `jarvis.${t}`)].join(", ") || "none"} · shell {a.bash ?? "none"}</dd>
                <dt>Writes</dt><dd>{a.write_roots.join(", ") || "read-only"}</dd>
                <dt>Skills</dt><dd>{a.skills.join(", ")}</dd><dt>Connectors</dt><dd>{a.connectors.join(", ")}</dd>
                <dt>Limits</dt><dd>{a.timeout_s}s · {a.max_turns} turns · {a.max_retries} retry</dd>
                <dt>Approval</dt><dd>{a.approval_always.join("; ")}</dd>
                <dt>Failure</dt><dd>{a.failure}</dd>
                {a.owner && <><dt>Owner</dt><dd>{a.owner}</dd></>}
              </dl>
            </div>
          ))}
          {!data?.catalog && <div className="text-muted">No catalogue snapshot yet (voice-line writes logs/catalog.json; or run `uv run python catalog.py json`).</div>}
        </div></section>
      )}
    </div>
  );
}
