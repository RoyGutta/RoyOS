import { childEnv } from "@/lib/jarvis/runs";
import { NextResponse } from "next/server";
import { approvalOriginGuard, localWriteGuard, rateLimiter } from "@/lib/jarvis/guard";
import { signApproval } from "@/lib/jarvis/approvalAuth";
import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

/**
 * POST /api/content/action — the dashboard's ONE write path into the Content OS.
 * It shells out to content_os.py so the file lock, prerequisites and audit log are
 * the same code Jarvis and the worker use. Explicit human actions only:
 *   {action:"approve", id, at?, note?} | {action:"reject", id, note} | {action:"pause", on:boolean} | {action:"queue", id, at} | {action:"rights", id, state, note}
 */
import { VOICE_LINE } from "@/lib/jarvis/runs";
const ID = /^cnt_[a-f0-9]{6,16}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = childEnv();
    execFile("uv", ["run", "python", "content_os.py", ...args], { cwd: VOICE_LINE, env, timeout: 60_000 }, (err, stdout, stderr) => {
      const lines = (stdout || "").trim().split("\n").filter((l) => l.startsWith("{"));
      resolve({ code: err ? 1 : 0, out: lines.pop() ?? (stderr || "").slice(-300) });
    });
  });
}

const limited = rateLimiter(30, 60_000);

export async function POST(req: Request) {
  const refused = localWriteGuard(req) ?? limited();
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; at?: string; note?: string; on?: boolean; state?: string };
  const by = "dashboard";
  let args: string[] | null = null;
  if ((b.action === "approve" || b.action === "approve-first") && b.id && ID.test(b.id)) {
    const refusedApproval = approvalOriginGuard(req);          // signing an approval needs the dashboard page itself
    if (refusedApproval) return refusedApproval;
    const v = await run(["version", b.id]);                     // the signature binds the exact content version the CLI sees now
    let cv: string | null = null;
    try { cv = (JSON.parse(v.out) as { contentVersion?: string }).contentVersion ?? null; } catch { cv = null; }
    if (!cv) return NextResponse.json({ ok: false, error: "content version unavailable; nothing signed" }, { status: 409 });
    // Roy's TWO tier: publishing is two separate clicks — "approve-first" signs first:content:…, "approve" the item itself
    args = b.action === "approve-first"
      ? ["approve", b.id, "--stage", "first", "--by", by, "--auth", signApproval(`first:content:${b.id}:${cv}`)]
      : ["approve", b.id, "--by", by, "--auth", signApproval(`content:${b.id}:${cv}`)];
    if (b.at && ISO.test(b.at)) args.push("--at", b.at);
    if (b.note) args.push("--note", b.note.slice(0, 300));
  } else if (b.action === "reject" && b.id && ID.test(b.id) && b.note) {
    args = ["reject", b.id, "--by", by, "--note", b.note.slice(0, 300)];
  } else if (b.action === "pause" && typeof b.on === "boolean") {
    args = ["pause", b.on ? "on" : "off", "--by", by];
  } else if (b.action === "rights" && b.id && ID.test(b.id) && b.state && /^[A-Z_]{5,16}$/.test(b.state)) {
    args = ["rights", b.id, b.state, "--by", by, "--note", (b.note ?? "").slice(0, 300)];
  } else if (b.action === "queue" && b.id && ID.test(b.id) && b.at && ISO.test(b.at)) {
    args = ["queue", b.id, b.at, "--by", by];
  }
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  const r = await run(args);
  let parsed: { ok?: boolean; error?: string } = {};
  try { parsed = JSON.parse(r.out); } catch { parsed = { ok: false, error: r.out || "no output" }; }
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
