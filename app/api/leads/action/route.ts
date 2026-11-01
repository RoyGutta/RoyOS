import { childEnv } from "@/lib/jarvis/runs";
import { NextResponse } from "next/server";
import { localWriteGuard, rateLimiter } from "@/lib/jarvis/guard";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DECISIONS, SERVICES } from "@/lib/business/leads";

import { VOICE_LINE } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads/action — the dashboard's ONE deterministic write path into the
 * lead pipeline. It shells out to voice-line/leads.py so the file lock, the
 * scoring rules and the audit trail are the same code Jarvis uses. Model-driven
 * work (research, proposals) goes through /api/jarvis/ask instead.
 *   {action:"audit", lead} | {action:"score", lead} | {action:"decide", lead, decision, note?, next?}
 *   | {action:"convert", lead, service?, name?, deadline?} | {action:"import", candidates:[...]}
 */
const ID = /^lead_[a-f0-9]{6,16}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function run(args: string[], timeout = 180_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = childEnv();
    execFile("uv", ["run", "python", "leads.py", ...args], { cwd: VOICE_LINE, env, timeout, maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
      const lines = (stdout || "").trim().split("\n").filter((l) => l.startsWith("{"));
      resolve({ code: err ? 1 : 0, out: lines.pop() ?? (stderr || "").slice(-300) });
    });
  });
}

const limited = rateLimiter(30, 60_000);

export async function POST(req: Request) {
  const refused = localWriteGuard(req) ?? limited();
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const lead = typeof b.lead === "string" && ID.test(b.lead) ? b.lead : null;
  let args: string[] | null = null;
  let tmp: string | null = null;
  if (b.action === "audit" && lead) args = ["audit", lead];
  else if (b.action === "score" && lead) args = ["score", lead];
  else if (b.action === "decide" && lead && (DECISIONS as readonly string[]).includes(String(b.decision))) {
    args = ["decide", lead, String(b.decision), "--by", "dashboard"];
    if (typeof b.note === "string" && b.note.trim()) args.push("--note", b.note.slice(0, 300));
    if (typeof b.next === "string" && b.next.trim()) args.push("--next", b.next.slice(0, 200));
  } else if (b.action === "convert" && lead) {
    const service = (SERVICES as readonly string[]).includes(String(b.service)) ? String(b.service) : "new_website";
    args = ["convert", lead, "--service", service];
    if (typeof b.name === "string" && b.name.trim()) args.push("--name", b.name.slice(0, 120));
    if (typeof b.deadline === "string" && ISO_DATE.test(b.deadline)) args.push("--deadline", b.deadline);
  } else if (b.action === "import" && Array.isArray(b.candidates) && b.candidates.length > 0 && b.candidates.length <= 50) {
    tmp = path.join(os.tmpdir(), `jarvis-import-${Date.now()}.json`);
    await fs.writeFile(tmp, JSON.stringify(b.candidates.slice(0, 50)));
    args = ["import", tmp, "--source", typeof b.source === "string" && /^[a-z_]{2,20}$/.test(b.source) ? b.source : "import"];
  }
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  // uv start-up + imports can take over a minute when the machine is swapping; audits also wait on the network.
  const r = await run(args, b.action === "audit" ? 240_000 : 180_000);
  if (tmp) await fs.unlink(tmp).catch(() => undefined);
  let parsed: { ok?: boolean; message?: string; error?: string } = {};
  try { parsed = JSON.parse(r.out); } catch { parsed = { ok: false, error: r.out || "no output from leads.py" }; }
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
