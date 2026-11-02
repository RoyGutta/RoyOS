import { NextResponse } from "next/server";
import { localWriteGuard, rateLimiter } from "@/lib/jarvis/guard";
import fs from "node:fs/promises";
import path from "node:path";

import { VOICE_LINE } from "@/lib/jarvis/runs";
import { redact } from "@/lib/jarvis/redact";
import { signApproval } from "@/lib/jarvis/approvalAuth";
import { requireApprovalSession } from "@/lib/jarvis/approvalSession";

export const dynamic = "force-dynamic";

const INBOX = path.join(VOICE_LINE, ".voice_inbox.jsonl");
const STATUS = path.join(VOICE_LINE, ".voice_status.json");
const KINDS = ["ask", "approve", "decline", "cancel"] as const;
const APPROVAL_ID = /^apr_[a-f0-9]{6,12}$/;

/**
 * POST /api/jarvis/ask — hands a command to the RUNNING voice line through its
 * inbox (main.py's inbox watcher feeds the same handler as the keyboard; there
 * is no second brain here).
 *   {text}                       → a request, spoken and executed like a typed line
 *   {kind:"approve", approvalId} → a "yes" bound to ONE pending action (ignored if stale)
 *   {kind:"decline", approvalId} → drops that pending action
 *   {kind:"cancel"}              → interrupts whatever is running
 * approve and decline are Roy's decisions: they need his Continuous Mode session + X-CSRF + the approval-grade origin
 * guard (G9-2); a yes is then signed (apr:<id>) and the runtime refuses an unsigned one.
 * 409 when the voice line is not running: nothing is queued for later.
 */
const approvalBucket = rateLimiter(20, 60_000);
const limited = rateLimiter(20, 60_000);

export async function POST(req: Request) {
  const refusedWrite = localWriteGuard(req);
  if (refusedWrite) return refusedWrite;
  const body = (await req.json().catch(() => ({}))) as { text?: string; kind?: string; approvalId?: string };
  const kind = (KINDS as readonly string[]).includes(body.kind ?? "") ? (body.kind as (typeof KINDS)[number]) : "ask";
  const text = (body.text ?? "").trim().slice(0, 2000);
  const rec: Record<string, unknown> = { ts: Date.now() / 1000, source: "dashboard", kind };
  if (kind === "ask") {
    const limitedAsk = limited(); if (limitedAsk) return limitedAsk;
    if (!text) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
    rec.text = redact(text); // a pasted secret never reaches the inbox file or the model
  } else if (kind === "approve" || kind === "decline") {
    if (!APPROVAL_ID.test(body.approvalId ?? "")) return NextResponse.json({ ok: false, error: "approvalId required" }, { status: 400 });
    const gate = await requireApprovalSession(req);       // session first: a forged attempt must not spend Roy's rate budget, and nothing is signed before it
    if (!gate.ok) return gate.res;
    const limitedApproval = approvalBucket(); if (limitedApproval) return limitedApproval;
    rec.approvalId = body.approvalId;
    if (kind === "approve") rec.auth = signApproval(`apr:${body.approvalId}`);   // the runtime refuses an unsigned yes
  }
  let running = false;
  try {
    const st = JSON.parse(await fs.readFile(STATUS, "utf-8")) as { ts?: number };
    running = !!st.ts && Date.now() / 1000 - st.ts < 120;
  } catch { running = false; }
  if (!running) return NextResponse.json({ ok: false, error: "Jarvis voice line is not running — start it with start-jarvis.command" }, { status: 409 });
  await fs.appendFile(INBOX, JSON.stringify(rec) + "\n");
  return NextResponse.json({ ok: true, kind });
}
