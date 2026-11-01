import { NextResponse } from "next/server";
import { localWriteGuard } from "@/lib/jarvis/guard";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { JARVIS_DIR, VOICE_LINE, childEnv } from "@/lib/jarvis/runs";
import { inflightLock } from "@/lib/jarvis/guard";

const lock = inflightLock();

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations — the connector registry snapshot (voice-line/registry.py
 * writes logs/integrations.json at voice-line start and every 5 min; statuses are
 * computed from real checks, never from a placeholder, and no secret value is
 * ever read) plus the agent catalogue (logs/catalog.json) and skills.
 * POST {action:"recheck"} — re-runs the probes now (registry.py json).
 */
const INTEGRATIONS = path.join(JARVIS_DIR, "logs", "integrations.json");
const CATALOG = path.join(JARVIS_DIR, "logs", "catalog.json");

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, "utf-8")) as T; } catch { return null; }
}

export async function GET() {
  const [reg, cat] = await Promise.all([readJson<{ version: string; checkedAt: string; connectors: unknown[]; skills: unknown[] }>(INTEGRATIONS), readJson<{ version: string; agents: unknown[] }>(CATALOG)]);
  return NextResponse.json({
    registry: reg, catalog: cat,
    note: reg ? `probed ${reg.checkedAt}` : "no snapshot yet — start the voice line or run `uv run python registry.py json`",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const refused = localWriteGuard(req);
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action !== "recheck") return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  if (!lock.acquire()) return NextResponse.json({ ok: false, error: "a re-check is already running" }, { status: 409 });
  const env = childEnv();
  const run = (script: string) => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    execFile("uv", ["run", "python", script, "json"], { cwd: VOICE_LINE, env, timeout: 180_000 }, (err, _stdout, stderr) => {
      resolve(err ? { ok: false, error: `${script}: ${(stderr || String(err)).slice(-300)}` } : { ok: true });
    });
  });
  // sequential: two `uv run` in the same project at once can race on the environment sync
  const a = await run("registry.py");
  const c = await run("catalog.py");
  lock.release();
  const out = { ok: a.ok && c.ok, error: [a.error, c.error].filter(Boolean).join("; ") || undefined };
  return NextResponse.json(out, { status: out.ok ? 200 : 409 });
}
