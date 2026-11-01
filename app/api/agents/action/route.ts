import { childEnv } from "@/lib/jarvis/runs";
import { NextResponse } from "next/server";
import { approvalOriginGuard, localWriteGuard, rateLimiter } from "@/lib/jarvis/guard";
import { signApproval } from "@/lib/jarvis/approvalAuth";
import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { AGENT_IDS } from "@/lib/jarvis/types";

import { VOICE_LINE } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/action — the dashboard's write path into the team ledger. It
 * shells out to voice-line/scheduler.py so the same lock, validation (claims
 * inside the role's scope, no live vault) and audit apply as for Jarvis itself.
 *   {action:"enqueue", agent, request, title?, acceptance?, claims?[], deps?[], inputs?[], parent?}
 *   {action:"cancel", task} | {action:"retry", task} | {action:"approve", task, approvalId}
 * Tasks run only while the voice line (the runtime that hosts the scheduler) is up;
 * queued work is reported as queued.
 */
const TASK = /^task_[a-f0-9]{6,16}$/;
const RUN = /^(run|task)_[a-f0-9]{6,16}$/;
const APR = /^apr_[a-f0-9]{6,12}$/;
const SAFE_PATH = /^\/[A-Za-z0-9_./ -]{1,300}$/;

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = childEnv();
    execFile("uv", ["run", "python", "scheduler.py", ...args], { cwd: VOICE_LINE, env, timeout: 180_000, maxBuffer: 2_000_000 }, (err, stdout, stderr) => {
      const lines = (stdout || "").trim().split("\n").filter((l) => l.startsWith("{"));
      resolve({ code: err ? 1 : 0, out: lines.pop() ?? (stderr || "").slice(-300) });
    });
  });
}

const limited = rateLimiter(20, 60_000);

export async function POST(req: Request) {
  const refused = localWriteGuard(req) ?? limited();
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const task = typeof b.task === "string" && TASK.test(b.task) ? b.task : null;
  let args: string[] | null = null;
  if (b.action === "enqueue" && (AGENT_IDS as readonly string[]).includes(String(b.agent)) && typeof b.request === "string" && b.request.trim().length >= 20) {
    args = ["enqueue", "--agent", String(b.agent), "--request", b.request.slice(0, 4000), "--by", "dashboard"];
    if (typeof b.title === "string" && b.title.trim()) args.push("--title", b.title.slice(0, 120));
    if (typeof b.acceptance === "string" && b.acceptance.trim()) args.push("--acceptance", b.acceptance.slice(0, 600));
    const rawClaims = Array.isArray(b.claims) ? b.claims.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
    if (rawClaims.some((c) => c.includes("Documents/RoyOS") || !SAFE_PATH.test(c)))
      return NextResponse.json({ ok: false, error: "a claim is invalid or inside the live RoyOS vault, which no agent may touch" }, { status: 400 });
    if (rawClaims.length) args.push("--claims", rawClaims.join(","));
    const ids = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).filter((x): x is string => typeof x === "string" && TASK.test(x)) : []);
    if (ids("deps").length) args.push("--deps", ids("deps").join(","));
    if (ids("inputs").length) args.push("--inputs", ids("inputs").join(","));
    if (typeof b.parent === "string" && RUN.test(b.parent)) args.push("--parent", b.parent);
  } else if (b.action === "cancel" && task) args = ["cancel", task];
  else if (b.action === "retry" && task) args = ["retry", task];
  else if (b.action === "approve" && task && typeof b.approvalId === "string" && APR.test(b.approvalId)) {
    const refusedApproval = approvalOriginGuard(req);
    if (refusedApproval) return refusedApproval;
    args = ["approve", task, b.approvalId, "--by", "dashboard", "--auth", signApproval(`task:${task}:${b.approvalId}`)];
  }
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  const r = await run(args);
  let parsed: { ok?: boolean; message?: string; error?: string; task?: string } = {};
  try { parsed = JSON.parse(r.out); } catch { parsed = { ok: false, error: r.out || "no output from scheduler.py" }; }
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
