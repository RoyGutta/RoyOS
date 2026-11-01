import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { SignedCommand } from "../commands";
import type { Snapshot } from "../snapshot";

/**
 * Local adapter: the dashboard on the Mac talks to the frozen supervisor install directly.
 *   /usr/bin/python3 -I -B ~/Library/Application Support/Jarvis/supervisor/bin/supervisor.py link-status
 *   … supervisor.py link-apply   (one signed command on stdin, channel "local")
 * execFile with a fixed argv (no shell), a 10 s timeout, a 64 KB output cap and a minimal environment. The path is
 * fixed in production; tests inject a fake runner through setRunnerForTests.
 */
export const PYTHON = "/usr/bin/python3";
export const SUPERVISOR_PY = path.join(os.homedir(), "Library", "Application Support", "Jarvis", "supervisor", "bin", "supervisor.py");
export const RUN_TIMEOUT_MS = 10_000;
export const OUTPUT_CAP_BYTES = 64 * 1024;
export const NOT_INSTALLED = "Mac-side link not installed (run supervisor.py install)";

export type Subcommand = "link-status" | "link-apply";
export interface RunResult { code: number | null; stdout: string; stderr: string; errno?: string }
export type Runner = (sub: Subcommand, stdin: string | null) => Promise<RunResult>;

function childEnv(): NodeJS.ProcessEnv {
  const out: Record<string, string> = { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", PYTHONDONTWRITEBYTECODE: "1" };
  for (const k of ["HOME", "USER", "LOGNAME", "TMPDIR", "TZ"]) { const v = process.env[k]; if (v) out[k] = v; }
  return out as NodeJS.ProcessEnv;
}

const realRunner: Runner = (sub, stdin) => new Promise((resolve) => {
  const child = execFile(PYTHON, ["-I", "-B", SUPERVISOR_PY, sub], { timeout: RUN_TIMEOUT_MS, maxBuffer: OUTPUT_CAP_BYTES, env: childEnv(), windowsHide: true }, (err, stdout, stderr) => {
    const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
    let errno: string | undefined;
    if (e && typeof e.code === "string") errno = e.code;
    else if (e?.killed) errno = "TIMEOUT";
    resolve({ code: e ? (typeof e.code === "number" ? e.code : null) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "").slice(0, 2000), errno });
  });
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(stdin ?? "");
});

let runner: Runner = realRunner;
export function setRunnerForTests(r: Runner | null) { runner = r ?? realRunner; }

function lastJsonLine(stdout: string): unknown | undefined {
  const lines = stdout.trim().split("\n").filter((l) => l.startsWith("{"));
  const last = lines.pop();
  if (!last) return undefined;
  try { return JSON.parse(last); } catch { return undefined; }
}

const T = (v: unknown, max: number): string | null => (typeof v === "string" ? v.replace(/[\p{C}]/gu, " ").slice(0, max) : null);
const B = (v: unknown): boolean => v === true;
const I = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** The local snapshot may carry session-written text: types are enforced, text is capped, and the UI renders it as text. */
export function sanitizeLocalSnapshot(x: unknown): Snapshot | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const s = o.supervisor as Record<string, unknown> | undefined;
  if (o.v !== 1 || !s || typeof s !== "object") return null;
  const model = s.model && typeof s.model === "object" ? (s.model as Record<string, unknown>) : null;
  const lr = s.lastRun && typeof s.lastRun === "object" ? (s.lastRun as Record<string, unknown>) : null;
  const us = s.usage && typeof s.usage === "object" ? (s.usage as Record<string, unknown>) : {};
  const blocksIn = us.modelBlocks && typeof us.modelBlocks === "object" ? (us.modelBlocks as Record<string, unknown>) : {};
  const modelBlocks: Snapshot["supervisor"]["usage"]["modelBlocks"] = {};
  for (const [k, v] of Object.entries(blocksIn).slice(0, 10)) {
    const b = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    modelBlocks[k.slice(0, 64)] = { until: T(b.until, 40) ?? "", reason: T(b.reason, 200) ?? "" };
  }
  const display = T(s.display, 32) ?? "error";
  return {
    v: 1, at: T(o.at, 40) ?? "", seq: I(o.seq), installId: T(o.installId, 16) ?? "", channel: "local",
    supervisor: {
      display: display as Snapshot["supervisor"]["display"], state: T(s.state, 40) ?? "", enabled: B(s.enabled), launchAgentLoaded: B(s.launchAgentLoaded), paused: B(s.paused), stopped: B(s.stopped),
      reason: T(s.reason, 200), model: model ? { requested: T(model.requested, 64) ?? "", requestedId: T(model.requestedId, 64) ?? "", actual: T(model.actual, 64), effort: T(model.effort, 32) } : null,
      currentTask: T(s.currentTask, 200), nextTask: T(s.nextTask, 200), taskSource: s.taskSource === "roy" || s.taskSource === "checkpoint" ? s.taskSource : null,
      lastRun: lr ? { runId: T(lr.runId, 64) ?? "", outcome: T(lr.outcome, 32) ?? "", model: T(lr.model, 64) ?? "", actualModel: T(lr.actualModel, 64), effort: T(lr.effort, 32), endedAt: T(lr.endedAt, 40), objective: T(lr.objective, 200), patchFiles: I(lr.patchFiles), agentsUsed: I(lr.agentsUsed), skillsUsed: I(lr.skillsUsed) } : null,
      usage: { status: (["ok", "limited", "waiting_for_reset", "unknown"].includes(String(us.status)) ? us.status : "unknown") as Snapshot["supervisor"]["usage"]["status"], resetAt: T(us.resetAt, 40), modelBlocks },
      runsToday: I(s.runsToday), maxRunsPerDay: I(s.maxRunsPerDay), nextCheckAt: T(s.nextCheckAt, 40),
    },
  };
}

export interface LocalStatus { installed: boolean; error: string | null; snapshot: Snapshot | null; receivedAt: string | null }

function describeFailure(r: RunResult, sub: Subcommand): { installed: boolean; error: string } {
  if (r.errno === "ENOENT") return { installed: false, error: NOT_INSTALLED };
  if (r.errno === "TIMEOUT") return { installed: true, error: `supervisor.py ${sub} timed out after ${RUN_TIMEOUT_MS / 1000} s` };
  if (r.errno === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { installed: true, error: `supervisor.py ${sub} printed more than 64 KB; refused` };
  if (/invalid choice|unrecognized|unknown command|usage:/i.test(r.stderr) && new RegExp(sub).test(r.stderr + " " + sub)) return { installed: false, error: `supervisor.py has no ${sub} yet (run supervisor.py install)` };
  return { installed: true, error: `supervisor.py ${sub} failed (exit ${r.code ?? "?"})${r.stderr ? ": " + r.stderr.replace(/[\p{C}]/gu, " ").slice(0, 200) : ""}` };
}

export async function localStatus(): Promise<LocalStatus> {
  const r = await runner("link-status", null);
  const parsed = r.code === 0 ? sanitizeLocalSnapshot(lastJsonLine(r.stdout)) : null;
  if (!parsed) {
    const f = r.code === 0 ? { installed: true, error: "supervisor.py link-status printed no snapshot" } : describeFailure(r, "link-status");
    return { ...f, snapshot: null, receivedAt: null };
  }
  return { installed: true, error: null, snapshot: parsed, receivedAt: new Date().toISOString() };
}

export interface ApplyResult { id: string; ok: boolean; message: string; snapshot: Snapshot | null }

export async function localApply(command: SignedCommand): Promise<ApplyResult> {
  const r = await runner("link-apply", JSON.stringify(command));
  const out = lastJsonLine(r.stdout) as Record<string, unknown> | undefined;
  if (!out || typeof out !== "object") {
    const f = describeFailure(r, "link-apply");
    return { id: command.id, ok: false, message: f.error, snapshot: null };
  }
  return { id: command.id, ok: out.ok === true, message: T(out.message, 200) ?? (out.ok === true ? "applied" : "refused"), snapshot: sanitizeLocalSnapshot(out.snapshot) };
}
