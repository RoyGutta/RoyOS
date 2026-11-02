import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { readRuns, runSummary, type Run, VOICE_LINE } from "@/lib/jarvis/runs";
import { buildActivity, buildTurns, type ActivityLine, type JarvisEvent, type Turn } from "@/lib/jarvis/events";
import { redactApprovalForCard } from "@/lib/jarvis/redact";
import { isHosted } from "@/lib/continuous/mode";
import { sessionFromCookieHeader } from "@/lib/continuous/auth";
import { approvalAuthContext } from "@/lib/jarvis/approvalSession";
import type { PendingApproval } from "@/lib/jarvis/types";
export type { PendingApproval } from "@/lib/jarvis/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/jarvis — READ-ONLY view of the voice line's interaction state, the
 * user-facing event stream folded into conversation turns, and the current run
 * from the ledger. Files (never written here): .voice_status.json,
 * .voice_events.jsonl, logs/runs.json. Brain: Claude via Roy's subscription;
 * no local model in the loop (a fact, not an inference).
 */
const STATUS = path.join(VOICE_LINE, ".voice_status.json");
const EVENTS = path.join(VOICE_LINE, ".voice_events.jsonl");
const MAX_EVENTS = 40;

export interface JarvisPayload {
  running: boolean; state: string; detail: string; backgroundJobs: number;
  pendingApproval: PendingApproval | null; statusAgeSeconds: number | null;
  brain: "claude-subscription"; localModelInLoop: false; resumed: boolean;
  lastYou: string | null; lastJarvis: string | null;
  turns: Turn[]; activity: ActivityLine[];
  actions: { ts: number; summary: string }[]; errors: { ts: number; where: string; message: string }[];
  recent: JarvisEvent[]; currentRun: Run | null; runs: { total: number; byState: Record<string, number> };
  lastFinished: { runId: string | null; state: string; ts: number } | null;
}

async function readStatus() {
  try {
    return JSON.parse(await fs.readFile(STATUS, "utf-8")) as { state?: string; detail?: string; background_jobs?: number; pending_approval?: PendingApproval | null; ts?: number };
  } catch { return null; }
}

async function readEvents(): Promise<JarvisEvent[]> {
  try {
    const raw = await fs.readFile(EVENTS, "utf-8");
    const out: JarvisEvent[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t) as JarvisEvent); } catch { /* torn line */ }
    }
    return out;
  } catch { return []; }
}

/** Sidebar G9-2 LOW: the unmasked outbound card text is for Roy's signed-in browser only; anything else gets it masked. */
async function signedIn(req: Request): Promise<boolean> {
  try { return !!(await sessionFromCookieHeader(req.headers.get("cookie"), approvalAuthContext(req.headers.get("host")))); } catch { return false; }
}

export async function GET(req: Request) {
  const [status, events, runs] = await Promise.all([readStatus(), readEvents(), readRuns()]);
  const now = Date.now() / 1000;
  const age = status?.ts ? now - status.ts : null;
  const running = age !== null && age < 120;
  const turns = buildTurns(events);
  const last = turns[turns.length - 1];
  let resumed = false;
  let lastFinished: JarvisPayload["lastFinished"] = null;
  const errors: { ts: number; where: string; message: string }[] = [];
  for (const e of events) {
    if (e.type === "session.connected" && e.resumed === true) resumed = true;
    if (e.type === "run.finished") lastFinished = { runId: (e.runId as string | null) ?? null, state: String(e.state), ts: e.ts };
    if (e.type === "error") errors.push({ ts: e.ts, where: String(e.where ?? ""), message: String(e.message ?? "").slice(0, 200) });
  }
  const activity = buildActivity(events);
  const summary = runSummary(runs);
  const payload: JarvisPayload = {
    running, state: running ? status?.state ?? "IDLE" : "OFFLINE", detail: status?.detail ?? "", backgroundJobs: status?.background_jobs ?? 0,
    // OB-10: masked like everything else, except the outbound review card's recipients and exact text on Roy's local dashboard
    pendingApproval: running && status?.pending_approval ? redactApprovalForCard(status.pending_approval, isHosted() || !(await signedIn(req))) : null, statusAgeSeconds: age === null ? null : Math.round(age),
    brain: "claude-subscription", localModelInLoop: false, resumed,
    lastYou: last?.you ?? null, lastJarvis: last?.jarvis || null,
    turns, activity, actions: activity.filter((a) => a.kind !== "task").map((a) => ({ ts: a.ts, summary: a.summary })).slice(-8),
    errors: errors.slice(-5),
    recent: events.filter((e) => e.type !== "model.delta").slice(-MAX_EVENTS).map((e) => (e.type === "transcript.final" ? { ...e, text: String(e.text ?? "").slice(0, 160) } : e)),
    currentRun: running ? summary.current : null, runs: { total: summary.total, byState: summary.byState }, lastFinished,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
