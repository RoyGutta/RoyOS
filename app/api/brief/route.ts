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
 * GET /api/brief — the latest saved daily brief (logs/briefs/latest.json, written
 * by voice-line/brief.py) and the routine's configuration + last-run state.
 * POST {action:"generate"} — runs `uv run python brief.py --json --force` now.
 * The brief reads connected sources only; nothing is sent anywhere.
 */
const LATEST = path.join(JARVIS_DIR, "logs", "briefs", "latest.json");
const STATE = path.join(JARVIS_DIR, "logs", "routines.json");
const CONFIG = path.join(JARVIS_DIR, "routines.json");
const DEFAULT_CFG = { enabled: true, timezone: "America/New_York", time: "08:00", channels: ["dashboard", "voice"], quietHours: { start: "22:00", end: "07:00" } };

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, "utf-8")) as T; } catch { return null; }
}

function nextRun(cfg: typeof DEFAULT_CFG, lastRunDate: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  const nowHM = `${get("hour")}:${get("minute")}`;
  const todayDue = nowHM < cfg.time && lastRunDate !== today;
  return { today, nowHM, when: !cfg.enabled ? "disabled" : todayDue ? `today ${cfg.time} ${cfg.timezone}` : `tomorrow ${cfg.time} ${cfg.timezone}`, pendingToday: nowHM >= cfg.time && lastRunDate !== today && cfg.enabled };
}

export async function GET() {
  const [brief, state, user] = await Promise.all([readJson<Record<string, unknown>>(LATEST), readJson<{ daily_brief?: Record<string, unknown> }>(STATE), readJson<{ daily_brief?: Partial<typeof DEFAULT_CFG> }>(CONFIG)]);
  const cfg = { ...DEFAULT_CFG, ...(user?.daily_brief ?? {}) };
  const st = state?.daily_brief ?? {};
  let nr: ReturnType<typeof nextRun>;
  try { nr = nextRun(cfg, st.lastRunDate as string | undefined); } catch { nr = { today: "", nowHM: "", when: `unknown (invalid timezone ${cfg.timezone})`, pendingToday: false }; }
  return NextResponse.json({
    brief, routine: { config: cfg, state: st, nextRun: nr.when, pendingToday: nr.pendingToday,
      scheduling: cfg.enabled ? "configured; fires inside the running voice line (once per local date, no daemon)" : "disabled in routines.json",
      userConfigFile: CONFIG },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const refused = localWriteGuard(req);
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action !== "generate") return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  if (!lock.acquire()) return NextResponse.json({ ok: false, error: "a brief is already being generated" }, { status: 409 });
  const env = childEnv();
  const out = await new Promise<{ ok: boolean; error?: string; brief?: unknown }>((resolve) => {
    execFile("uv", ["run", "python", "brief.py", "--json", "--force"], { cwd: VOICE_LINE, env, timeout: 180_000, maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
      const line = (stdout || "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
      try { resolve(JSON.parse(line ?? "") as { ok: boolean; error?: string; brief?: unknown }); } catch { resolve({ ok: false, error: (stderr || String(err) || "no output").slice(-300) }); }
    });
  });
  lock.release();
  return NextResponse.json(out, { status: out.ok ? 200 : 409 });
}
