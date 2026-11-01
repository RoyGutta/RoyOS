import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { JARVIS_DIR, VOICE_LINE, childEnv } from "@/lib/jarvis/runs";
import { signApproval } from "@/lib/jarvis/approvalAuth";
import { approvalOriginGuard, localWriteGuard, inflightLock } from "@/lib/jarvis/guard";

export const dynamic = "force-dynamic";
const lock = inflightLock();
const PID = /^wf_[a-f0-9]{6,12}$/;

/**
 * GET  /api/factory — every website-factory project (logs/factory.json, written by voice-line/factory.py). Read-only.
 * POST /api/factory — {action:"start", brief} | {action:"answer", project, answers} | {action:"approve-plan", project, planHash (12 hex, from the record)}
 *                   | {action:"approve-deploy", project, siteHash (the reviewed hash)} | {action:"cancel", project} | {action:"run", project}
 * Writes shell out to factory.py so the same validation, state machine and audit apply as for Jarvis itself.
 * approve-plan / approve-deploy are human decisions from this dashboard (recorded with by=dashboard).
 */
export async function GET() {
  try {
    const d = JSON.parse(await fs.readFile(path.join(JARVIS_DIR, "logs", "factory.json"), "utf-8")) as { projects?: unknown[] };
    return NextResponse.json({ projects: [...(d.projects ?? [])].reverse() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ projects: [] }, { headers: { "Cache-Control": "no-store" } }); }
}

function run(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const env = childEnv();
    execFile("uv", ["run", "python", "factory.py", ...args], { cwd: VOICE_LINE, env, timeout: 300_000, maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
      const line = (stdout || "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
      resolve({ ok: !err, out: line ?? (stderr || String(err)).slice(-300) });
    });
  });
}

export async function POST(req: Request) {
  const refused = localWriteGuard(req);
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const project = typeof b.project === "string" && PID.test(b.project) ? b.project : null;
  let args: string[] | null = null;
  let tmp: string | null = null;
  if (b.action === "start" && b.brief && typeof b.brief === "object") {
    tmp = path.join(os.tmpdir(), `jarvis-brief-${Date.now()}.json`);
    await fs.writeFile(tmp, JSON.stringify(b.brief).slice(0, 60_000));   // client data, stored as given; secret-shaped values are a gate finding, not silently rewritten
    args = ["start", tmp, "--by", "dashboard"];
  } else if (b.action === "answer" && project && b.answers && typeof b.answers === "object") args = ["answer", project, JSON.stringify(b.answers).slice(0, 20_000)];
  else if ((b.action === "approve-plan" || b.action === "approve-deploy" || b.action === "approve-deploy-first") && approvalOriginGuard(req)) return approvalOriginGuard(req) as NextResponse;
  else if (b.action === "approve-plan" && project && typeof b.planHash === "string" && /^[a-f0-9]{12}$/.test(b.planHash)) args = ["approve-plan", project, "--by", "dashboard", "--plan-hash", b.planHash, "--auth", signApproval(`plan:${project}:${b.planHash}`)];
  // Roy's TWO tier: deploying is two separate clicks. The first signs "first:deploy:…" (recorded by the runtime), the second
  // signs "deploy:…" and is accepted only with that first confirmation 2 s – 5 min old (factory.confirm_deploy_first / approve_deploy).
  else if (b.action === "approve-deploy-first" && project && typeof b.siteHash === "string" && /^[a-f0-9]{12,64}$/.test(b.siteHash)) args = ["approve-deploy-first", project, "--site-hash", b.siteHash, "--auth", signApproval(`first:deploy:${project}:${b.siteHash}`)];
  else if (b.action === "approve-deploy" && project && typeof b.siteHash === "string" && /^[a-f0-9]{12,64}$/.test(b.siteHash)) args = ["approve-deploy", project, "--by", "dashboard", "--site-hash", b.siteHash, "--auth", signApproval(`deploy:${project}:${b.siteHash}`)];
  else if (b.action === "cancel" && project) args = ["cancel", project, "--by", "dashboard"];
  else if (b.action === "run" && project) args = ["run", project];
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  if (!lock.acquire()) { if (tmp) await fs.unlink(tmp).catch(() => undefined); return NextResponse.json({ ok: false, error: "another factory action is running" }, { status: 409 }); }
  let r: { ok: boolean; out: string };
  try { r = await run(args); } finally { lock.release(); if (tmp) await fs.unlink(tmp).catch(() => undefined); }
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(r.out); } catch { parsed = { ok: false, error: r.out || "no output from factory.py" }; }
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
