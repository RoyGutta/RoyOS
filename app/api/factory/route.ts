import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { JARVIS_DIR } from "@/lib/jarvis/runs";
import { signApproval } from "@/lib/jarvis/approvalAuth";
import { requireApprovalSession } from "@/lib/jarvis/approvalSession";
import { parseCliJson, runCli } from "@/lib/jarvis/cli";
import { inflightLock, localWriteGuard } from "@/lib/jarvis/guard";
import { NONCE, SITE_HASH, firstClick, secondClick } from "@/lib/jarvis/twoClick";

export const dynamic = "force-dynamic";
const lock = inflightLock();
const PID = /^wf_[a-f0-9]{6,12}$/;
const APPROVALS = new Set(["approve-plan", "approve-deploy-first", "approve-deploy"]);

/**
 * GET  /api/factory — every website-factory project (logs/factory.json, written by voice-line/factory.py). Read-only.
 * POST /api/factory — {action:"start", brief} | {action:"answer", project, answers} | {action:"approve-plan", project, planHash (12 hex, from the record)}
 *                   | {action:"approve-deploy-first", project, siteHash (the reviewed hash)} → {ok, nonce}
 *                   | {action:"approve-deploy", project, siteHash, nonce (from click 1)} | {action:"cancel", project} | {action:"run", project}
 * Writes shell out to factory.py so the same validation, state machine and audit apply as for Jarvis itself.
 * The three approve-* actions are human decisions: they need Roy's Continuous Mode session + X-CSRF + the approval-grade
 * origin guard (G9-2), and deploying is two separate clicks (lib/jarvis/twoClick.ts). Recorded with by=dashboard.
 */
export async function GET() {
  try {
    const d = JSON.parse(await fs.readFile(path.join(JARVIS_DIR, "logs", "factory.json"), "utf-8")) as { projects?: unknown[] };
    return NextResponse.json({ projects: [...(d.projects ?? [])].reverse() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ projects: [] }, { headers: { "Cache-Control": "no-store" } }); }
}

export async function POST(req: Request) {
  const refused = localWriteGuard(req);
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (APPROVALS.has(String(b.action))) {
    const gate = await requireApprovalSession(req);     // G9-2: session + X-CSRF + origin, before anything is signed
    if (!gate.ok) return gate.res;
  }
  const project = typeof b.project === "string" && PID.test(b.project) ? b.project : null;
  const siteHash = typeof b.siteHash === "string" && SITE_HASH.test(b.siteHash) ? b.siteHash : null;
  let args: string[] | null = null;
  let stdin: string | null = null;
  let nonce: string | null = null;
  let tmp: string | null = null;
  if (b.action === "start" && b.brief && typeof b.brief === "object") {
    tmp = path.join(os.tmpdir(), `jarvis-brief-${Date.now()}.json`);
    await fs.writeFile(tmp, JSON.stringify(b.brief).slice(0, 60_000));   // client data, stored as given; secret-shaped values are a gate finding, not silently rewritten
    args = ["start", tmp, "--by", "dashboard"];
  } else if (b.action === "answer" && project && b.answers && typeof b.answers === "object") args = ["answer", project, JSON.stringify(b.answers).slice(0, 20_000)];
  // approve-plan: one click; its signature goes on stdin like the others (Sidebar G9v2-3)
  else if (b.action === "approve-plan" && project && typeof b.planHash === "string" && /^[a-f0-9]{12}$/.test(b.planHash)) {
    stdin = JSON.stringify({ sig: signApproval(`plan:${project}:${b.planHash}`) });
    args = ["approve-plan", project, "--by", "dashboard", "--plan-hash", b.planHash, "--auth-stdin"];
  }
  // Roy's TWO tier: deploying is two separate clicks. Click 1 signs first:deploy:…:<nonce>:<issuedAt> (recorded by the
  // runtime) and returns the nonce; click 2 echoes it and signs deploy:…:<nonce>:<issuedAt2>, accepted only with that first
  // confirmation 2 s – 5 min old. Both signatures go on stdin, never argv (docs/APPROVALS-TWO-CLICK.md).
  else if (b.action === "approve-deploy-first" && project && siteHash) {
    const c = firstClick(`deploy:${project}:${siteHash}`);
    nonce = c.nonce; stdin = c.stdin;
    args = ["approve-deploy-first", project, "--site-hash", siteHash, "--auth-stdin"];
  } else if (b.action === "approve-deploy" && project && siteHash) {
    if (typeof b.nonce !== "string" || !NONCE.test(b.nonce)) return NextResponse.json({ ok: false, error: "click 1 first: the confirmation needs the nonce returned by \"Approve deployment (1 of 2)\"" }, { status: 400 });
    stdin = secondClick(`deploy:${project}:${siteHash}`, b.nonce).stdin;
    args = ["approve-deploy", project, "--site-hash", siteHash, "--by", "dashboard", "--auth-stdin"];
  }
  else if (b.action === "cancel" && project) args = ["cancel", project, "--by", "dashboard"];
  else if (b.action === "run" && project) args = ["run", project];
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  if (!lock.acquire()) { if (tmp) await fs.unlink(tmp).catch(() => undefined); return NextResponse.json({ ok: false, error: "another factory action is running" }, { status: 409 }); }
  let parsed: Record<string, unknown>;
  try { parsed = parseCliJson(await runCli("factory.py", args, stdin, { timeoutMs: 300_000, maxBuffer: 4_000_000 }), "factory.py"); }
  finally { lock.release(); if (tmp) await fs.unlink(tmp).catch(() => undefined); }
  if (parsed.ok === true && nonce) parsed.nonce = nonce;          // click 1 succeeded: the browser keeps this for click 2
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
