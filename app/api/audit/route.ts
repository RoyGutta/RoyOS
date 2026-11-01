import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { JARVIS_DIR } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";

/** GET /api/audit?limit=50 — the tail of logs/audit.jsonl (approvals, executed actions, routines). Read-only; already redacted at write time. */
export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.floor(raw))) : 50;
  let lines: string[] = [];
  try { lines = (await fs.readFile(path.join(JARVIS_DIR, "logs", "audit.jsonl"), "utf-8")).trim().split("\n"); } catch { /* none yet */ }
  const records = lines.slice(-limit).reverse().flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  return NextResponse.json({ records }, { headers: { "Cache-Control": "no-store" } });
}
