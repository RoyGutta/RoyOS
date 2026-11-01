"use client";

import { usePolling, timeAgo } from "./usePolling";

/* Shapes come from app/api/projects/route.ts: projects/index.json entries plus dir, docs and statusHead. */
export type ProjectStatus = "functional" | "partial" | "mock-only" | "awaiting-authorization" | "blocked" | "planned" | string;
export type ProviderLabel = "local-functional" | "mock-only" | "authorization-pending" | "live-verified" | string;
export interface PortfolioProject {
  id: string;
  name: string;
  owner: "main" | "sidebar" | string;
  status: ProjectStatus;
  summary: string;
  entry?: string;
  runtime?: string[];
  providers?: Record<string, ProviderLabel>;
  nextStep?: string;
  dir: string;
  docs: Record<string, boolean>;
  statusHead: string;
}
export interface PortfolioPayload { version?: string; projects: PortfolioProject[]; note?: string }

const DOCS = ["README.md", "PRD.md", "ARCHITECTURE.md", "STATUS.md", "SECURITY.md", "TESTING.md", "DECISIONS.md"];

/* globals.css only ships connector-named status-chip modifiers; reuse them by colour. */
function statusChip(s: string): string {
  if (s === "functional") return "status-chip--available";
  if (s === "partial" || s === "mock-only" || s === "awaiting-authorization") return "status-chip--needs_permission";
  if (s === "blocked") return "status-chip--error";
  return "status-chip--disabled";
}
function providerBadge(l: string): string {
  if (l === "live-verified") return "badge--ok";
  if (l === "local-functional") return "badge--accent";
  if (l === "authorization-pending" || l === "mock-only") return "badge--warn";
  return "";
}

export default function PortfolioView() {
  const { data, error, loading, updatedAt } = usePolling<PortfolioPayload>("/api/projects", 10000);
  const projects = data?.projects ?? [];
  const counts: Record<string, number> = {};
  for (const p of projects) counts[p.status] = (counts[p.status] ?? 0) + 1;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head">
          <span className="eyebrow">Projects</span>
          <span className="text-muted text-[11px]">
            {loading && !data ? "loading…" : data?.version ? `index ${data.version}` : data?.note ?? "no index"}
            {updatedAt ? ` · refreshed ${timeAgo(new Date(updatedAt).toISOString())}` : ""}
          </span>
          {error && <span className="ml-auto badge badge--bad" role="status">could not load: {error}</span>}
        </div>
        <div className="px-4 py-3 flex flex-wrap gap-2 text-[12px]">
          {Object.entries(counts).map(([k, v]) => <span key={k} className={`status-chip ${statusChip(k)}`}>{k.replace(/-/g, " ")} · {v}</span>)}
          <span className="text-muted ml-auto">Status words come from projects/index.json; a provider label says what was actually verified.</span>
        </div>
      </section>

      {!loading && !error && projects.length === 0 && (
        <section className="panel"><div className="px-4 py-3 text-[12px] text-muted">No portfolio index. {data?.note ?? "Create projects/index.json in the Jarvis directory"} — each entry needs id, name, owner, status, summary.</div></section>
      )}

      {loading && !data && <section className="panel"><div className="px-4 py-3 text-[12px] text-muted" aria-busy="true">Loading projects…</div></section>}

      <div className="grid gap-3 lg:grid-cols-2">
        {projects.map((p) => (
          <section key={p.id} className="panel">
            <div className="panel__head">
              <span className="text-ink text-[13px]">{p.name}</span>
              <span className={`status-chip ${statusChip(p.status)}`}>{p.status.replace(/-/g, " ")}</span>
              <span className="ml-auto text-muted text-[11px]">owner · {p.owner}</span>
            </div>
            <div className="px-4 py-3 text-[12px] flex flex-col gap-2">
              <p className="text-ink">{p.summary}</p>
              <dl className="hud__dl">
                <dt>Path</dt><dd><code className="text-[11px]">{p.dir}</code>{p.entry && <span className="text-muted"> · entry {p.entry}</span>}</dd>
                {p.runtime && p.runtime.length > 0 && <><dt>Runtime</dt><dd className="text-muted">{p.runtime.join(", ")}</dd></>}
                <dt>Providers</dt>
                <dd>
                  {p.providers && Object.keys(p.providers).length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(p.providers).map(([k, l]) => <span key={k} className={`badge ${providerBadge(l)}`} title={`${k}: ${l}`}>{k} · {l.replace(/-/g, " ")}</span>)}
                    </span>
                  ) : <span className="text-muted">none declared</span>}
                </dd>
                <dt>Next</dt><dd>{p.nextStep ?? <span className="text-muted">—</span>}</dd>
                <dt>Docs</dt>
                <dd>
                  <span className="flex flex-wrap gap-1">
                    {DOCS.map((d) => {
                      const present = p.docs?.[d] === true;
                      return <span key={d} className={`badge ${present ? "badge--ok" : ""}`} title={present ? `${d} present` : `${d} missing`}>{d.replace(".md", "")}{present ? "" : " · missing"}</span>;
                    })}
                  </span>
                </dd>
              </dl>
              <details>
                <summary className="text-muted cursor-pointer text-[11px]">STATUS.md{p.statusHead ? "" : " (not present)"}</summary>
                {p.statusHead ? <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words text-ink">{p.statusHead}</pre> : <div className="mt-1 text-muted text-[11px]">No STATUS.md in {p.dir}.</div>}
              </details>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
