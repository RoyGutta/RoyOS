import { execFile } from "node:child_process";
import { VOICE_LINE, childEnv } from "./runs";

/**
 * The dashboard's one way to run a voice-line CLI (factory.py, content_os.py, scheduler.py): `uv run python <script> …`
 * with a fixed argv (no shell), the allowlisted child environment, a timeout and an output cap. An approval signature
 * never travels in argv (G9-4: argv is visible to every same-user process through `ps`); it goes to the child's stdin as
 * one JSON document and stdin is closed right after. The CLI's answer is the last stdout line that starts with "{".
 * Tests inject a fake runner through setCliRunnerForTests, the pattern of lib/continuous/adapters/local.ts.
 */
export type CliScript = "factory.py" | "content_os.py" | "scheduler.py";
export interface CliResult { code: number; out: string }
export interface CliOptions { timeoutMs: number; maxBuffer?: number }
export type CliRunner = (script: CliScript, args: readonly string[], stdin: string | null, opts: CliOptions) => Promise<CliResult>;

const realRunner: CliRunner = (script, args, stdin, opts) => new Promise((resolve) => {
  const child = execFile("uv", ["run", "python", script, ...args], { cwd: VOICE_LINE, env: childEnv(), timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer ?? 2_000_000 }, (err, stdout, stderr) => {
    const line = String(stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
    resolve({ code: err ? 1 : 0, out: line ?? (String(stderr ?? "") || (err ? String(err) : "")).slice(-300) });
  });
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(stdin ?? "");
});

let runner: CliRunner = realRunner;
export function setCliRunnerForTests(r: CliRunner | null) { runner = r ?? realRunner; }

export function runCli(script: CliScript, args: readonly string[], stdin: string | null, opts: CliOptions): Promise<CliResult> {
  return runner(script, args, stdin, opts);
}

/** The CLI's JSON answer, or a failure record naming the script when it printed none. */
export function parseCliJson(r: CliResult, script: CliScript): Record<string, unknown> {
  try {
    const v = JSON.parse(r.out) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* not json */ }
  return { ok: false, error: r.out || `no output from ${script}` };
}
