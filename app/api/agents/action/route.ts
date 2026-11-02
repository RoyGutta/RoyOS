import { NextResponse } from "next/server";
import { signApproval } from "@/lib/jarvis/approvalAuth";
import { requireApprovalSession } from "@/lib/jarvis/approvalSession";
import { parseCliJson, runCli } from "@/lib/jarvis/cli";
import { localWriteGuard, rateLimiter } from "@/lib/jarvis/guard";
import { AGENT_IDS } from "@/lib/jarvis/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/action — the dashboard's write path into the team ledger. It
 * shells out to voice-line/scheduler.py so the same lock, validation (claims
 * inside the role's scope, no live vault) and audit apply as for Jarvis itself.
 *   {action:"enqueue", agent, request, title?, acceptance?, claims?[], deps?[], inputs?[], parent?}
 *   {action:"cancel", task} | {action:"retry", task} | {action:"approve", task, approvalId}
 * Tasks run only while the voice line (the runtime that hosts the scheduler) is up;
 * queued work is reported as queued. "approve" signs task:<task>:<apr> and therefore needs Roy's
 * Continuous Mode session + X-CSRF + the origin guard (G9-2).
 */
const TASK = /^task_[a-f0-9]{6,16}$/;
const RUN = /^(run|task)_[a-f0-9]{6,16}$/;
const APR = /^apr_[a-f0-9]{6,12}$/;
const SAFE_PATH = /^\/[A-Za-z0-9_./ -]{1,300}$/;
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
  else if (b.action === "approve") {
    const gate = await requireApprovalSession(req);     // G9-2: session + X-CSRF + origin, before anything is signed
    if (!gate.ok) return gate.res;
    if (!task || typeof b.approvalId !== "string" || !APR.test(b.approvalId)) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
    // The signature still travels in argv here: scheduler.py approve has no --auth-stdin yet (G9-4 residual).
    args = ["approve", task, b.approvalId, "--by", "dashboard", "--auth", signApproval(`task:${task}:${b.approvalId}`)];
  }
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  const parsed = parseCliJson(await runCli("scheduler.py", args, null, { timeoutMs: 180_000, maxBuffer: 2_000_000 }), "scheduler.py");
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
