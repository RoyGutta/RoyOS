import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { JARVIS_DIR, readRuns } from "@/lib/jarvis/runs";
import type { AgentInfo, Run, Task } from "@/lib/jarvis/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AGENTS_FILE = path.join(JARVIS_DIR, "logs", "agents.json");
const CATALOG_FILE = path.join(JARVIS_DIR, "logs", "catalog.json");
const STATIC: Record<string, { name: string; responsibility: string; catalogStatus: string; dispatchable: boolean }> = {
  core: { name: "Core Systems (Software Engineering)", responsibility: "Jarvis itself: voice, runtime, ledger, tools, dashboard, reliability", catalogStatus: "operational", dispatchable: true },
  research: { name: "Research Agent", responsibility: "documentation, competitors, products, tools and technical options — sourced, dated", catalogStatus: "operational", dispatchable: true },
  reviewer: { name: "QA & Integration (Critic / Reviewer)", responsibility: "independent review: tests, regressions, unverified claims, conflicts, docs", catalogStatus: "operational", dispatchable: true },
  security: { name: "Security Reviewer", responsibility: "read-only security review; runs gate.py", catalogStatus: "operational", dispatchable: true },
  accessibility: { name: "Accessibility Reviewer", responsibility: "read-only accessibility review; runs the auditor", catalogStatus: "operational", dispatchable: true },
  business: { name: "Business & Growth", responsibility: "prospecting, lead research, website audits, scoring, proposals, CRM, delivery", catalogStatus: "operational", dispatchable: true },
  tidefable: { name: "Tidefable Studio (Content Agent)", responsibility: "Content OS: research, scripts, storyboards, sources, rendering, creative QA", catalogStatus: "operational", dispatchable: true },
  design: { name: "UI / Design Agent", responsibility: "interface hierarchy, usability, accessibility, responsive behaviour, isolated UI changes", catalogStatus: "operational", dispatchable: true },
  planner: { name: "Research & Planning Agent", responsibility: "bounded plans with milestones, owners and acceptance criteria", catalogStatus: "operational", dispatchable: true },
};

/** GET /api/agents — the team's real state: agents.json (written by the scheduler) + task tree from the ledger. Read-only. */
export async function GET() {
  let state: { agents?: Record<string, Partial<AgentInfo>>; scheduler?: Record<string, unknown> } = {};
  try { state = JSON.parse(await fs.readFile(AGENTS_FILE, "utf-8")); } catch { /* scheduler never ran */ }
  // The catalogue snapshot (voice-line/catalog.py) is the source of truth for names and status; STATIC is the fallback.
  const known: Record<string, { name: string; responsibility: string; catalogStatus: string; dispatchable: boolean }> = { ...STATIC };
  try {
    const cat = JSON.parse(await fs.readFile(CATALOG_FILE, "utf-8")) as { agents?: { id: string; name: string; responsibility: string; status: string; dispatchable: boolean }[] };
    for (const a of cat.agents ?? []) if (a.dispatchable) known[a.id] = { name: a.name, responsibility: a.responsibility, catalogStatus: a.status, dispatchable: a.dispatchable };
  } catch { /* no snapshot yet */ }
  const all = await readRuns();
  const tasks = all.filter((r) => (r as unknown as Task).kind === "task") as unknown as Task[];
  const byId = new Map<string, Run>(all.map((r) => [r.id, r]));
  const agents: AgentInfo[] = Object.entries(known).map(([id, s]) => ({
    id, ...s, writeRoots: [], tools: [], bash: "", configVersion: "", sessionId: null, sessionAt: 0, status: "IDLE", currentTaskId: null, parentRunId: null, lastActivity: null, recent: [],
    ...(state.agents?.[id] ?? {}),
  }));
  const parents: string[] = [];
  for (const t of tasks) if (t.parentId && !parents.includes(t.parentId)) parents.push(t.parentId);
  const tree = parents.slice(0, 30).map((pid) => ({
    parent: byId.get(pid) ?? ({ id: pid, request: "(parent not in ledger)", state: "UNKNOWN" } as unknown as Run),
    children: tasks.filter((t) => t.parentId === pid).reverse(),
  }));
  const open = tasks.filter((t) => !["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(t.state));
  return NextResponse.json({ agents, scheduler: state.scheduler ?? null, open, tasks: tasks.slice(0, 200), tree, schedulerAlive: !!state.scheduler && Date.now() - Date.parse(String((state.scheduler as { updatedAt?: string }).updatedAt ?? 0)) < 30_000 },
    { headers: { "Cache-Control": "no-store" } });
}
