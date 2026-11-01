import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * READ-ONLY view of Jarvis's run ledger (~/Developer/Jarvis/logs/runs.json,
 * written by voice-line/runs.py). One record per request the runtime handled —
 * voice, typed, dashboard or scripted. The dashboard never writes it.
 */
/** The authoritative Jarvis workspace (decision 2026-10-11: ~/Developer, not the iCloud-managed ~/Documents copy). */
export const JARVIS_DIR = process.env.JARVIS_DIR?.trim() || path.join(os.homedir(), "Developer/Jarvis");
export const VOICE_LINE = process.env.JARVIS_VOICE_LINE?.trim() || path.join(JARVIS_DIR, "voice-line");
export const RUNS_FILE = path.join(JARVIS_DIR, "logs", "runs.json");

export { RUN_STATES, RUN_SOURCES } from "./types";
export type { Run, RunState, RunTool } from "./types";
import type { Run } from "./types";

/** Corrupt-ledger visibility: the runtime quarantines an unreadable runs.json and leaves a sticky .CORRUPT marker. The
 *  dashboard must say so instead of showing "no runs" (parked approvals and claims would look gone). */
export async function ledgerState(): Promise<{ ok: boolean; state: "ok" | "LEDGER_CORRUPT"; marker?: string; quarantined?: string; action?: string }> {
  const marker = RUNS_FILE + ".CORRUPT";
  try {
    const q = (await fs.readFile(marker, "utf-8")).trim();
    return { ok: false, state: "LEDGER_CORRUPT", marker, quarantined: q, action: "restore logs/runs.json from the quarantined copy or a backup, then remove the .CORRUPT marker" };
  } catch { return { ok: true, state: "ok" }; }
}

export async function readRuns(): Promise<Run[]> {
  try {
    const raw = JSON.parse(await fs.readFile(RUNS_FILE, "utf-8")) as { runs?: Run[] };
    return Array.isArray(raw.runs) ? [...raw.runs].reverse() : [];
  } catch {
    return [];
  }
}

export function runSummary(runs: Run[]) {
  const byState: Record<string, number> = {};
  for (const r of runs) byState[r.state] = (byState[r.state] ?? 0) + 1;
  const active = runs.filter((r) => r.state === "RUNNING" || r.state === "WAITING_FOR_APPROVAL");
  return { total: runs.length, byState, active: active.slice(0, 5), current: active[0] ?? null };
}


/** Allowlisted environment for child processes (uv/python): no secrets, no loader variables, never Roy's foreground. */
export function childEnv(): NodeJS.ProcessEnv {
  const keep = ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "TZ"];
  const out = {} as NodeJS.ProcessEnv;
  for (const k of keep) { const v = process.env[k]; if (v) out[k] = v; }
  for (const k of Object.keys(process.env)) { const v = process.env[k]; if (v && /^(JARVIS_|KOKORO_|WHISPER_|UV_CACHE|VIRTUAL_ENV)/.test(k) && !/(KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE)/i.test(k)) out[k] = v; }
  out.PATH = `${process.env.HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  out.JARVIS_NOT_FOREGROUND = "1";
  return out;
}
