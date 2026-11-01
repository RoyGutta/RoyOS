/**
 * Snapshot v1 (contract v1.1 §Snapshots): the Mac's report of the supervisor. Pure module (client + server).
 *
 * The LOCAL snapshot (`link-status`) may carry session-written text; it never leaves the Mac. The HOSTED one is
 * restricted to fixed enums, counts, times, booleans and model ids (LP-3) and `validateHostedSnapshot` re-validates
 * that shape server-side, key by key, refusing anything else. Every dashboard renders every field as plain text.
 */
export const DISPLAYS = ["disabled", "starting", "running", "paused", "waiting_for_reset", "blocked", "stopped", "done", "error"] as const;
export type Display = (typeof DISPLAYS)[number];
export const REASON_CODES = ["roy_paused", "roy_stopped", "limit", "daily_cap", "conflict", "needs_roy", "error", "none"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const USAGE_STATUS = ["ok", "limited", "waiting_for_reset", "unknown"] as const;
export const TASK_SOURCES = ["roy", "checkpoint"] as const;
export const ONLINE_WINDOW_SEC = 60;

export interface SnapshotModel { requested: string; requestedId: string; actual: string | null; effort: string | null }
export interface SnapshotLastRun {
  runId: string; outcome: string; model: string; actualModel: string | null; effort: string | null; endedAt: string | null;
  objective: string | null; patchFiles: number; agentsUsed: number; skillsUsed: number;
}
export interface SnapshotUsage { status: (typeof USAGE_STATUS)[number]; resetAt: string | null; modelBlocks: Record<string, { until: string; reason: string }> }
export interface SupervisorSnapshot {
  display: Display; state: string; enabled: boolean; launchAgentLoaded: boolean; paused: boolean; stopped: boolean;
  reason: string | null; model: SnapshotModel | null; currentTask: string | null; nextTask: string | null;
  taskSource: "roy" | "checkpoint" | null; lastRun: SnapshotLastRun | null; usage: SnapshotUsage;
  runsToday: number; maxRunsPerDay: number; nextCheckAt: string | null;
}
export interface Snapshot { v: 1; at: string; seq: number; installId: string; channel: "local" | "remote"; supervisor: SupervisorSnapshot }

/** Online = the latest snapshot is less than 60 s old. No snapshot → not online and no age. */
export function onlineFrom(receivedAt: string | null | undefined, nowMs: number): { online: boolean; ageSec: number | null } {
  if (!receivedAt) return { online: false, ageSec: null };
  const t = Date.parse(receivedAt);
  if (Number.isNaN(t)) return { online: false, ageSec: null };
  const ageSec = Math.max(0, (nowMs - t) / 1000);
  return { online: ageSec < ONLINE_WINDOW_SEC, ageSec };
}

// ---- hosted shape re-validation --------------------------------------------------------------------------------
type Check = (v: unknown, path: string) => string | null;   // null = fine, string = error
const TOKEN64 = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TOKEN40 = /^[A-Za-z0-9_-]{1,40}$/;
const TOKEN32 = /^[a-z][a-z0-9_]{0,31}$/;
const TEXT120 = /^[^\p{C}]{1,120}$/u;

const isBool: Check = (v, p) => (typeof v === "boolean" ? null : `${p} must be a boolean`);
const isInt = (max: number): Check => (v, p) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? null : `${p} must be an integer 0..${max}`);
const isIso: Check = (v, p) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? null : `${p} must be an ISO time`);
const matches = (re: RegExp, what: string): Check => (v, p) => (typeof v === "string" && re.test(v) ? null : `${p} must be ${what}`);
const oneOf = (list: readonly string[]): Check => (v, p) => (typeof v === "string" && list.includes(v) ? null : `${p} must be one of ${list.join("|")}`);
const nullable = (c: Check): Check => (v, p) => (v === null ? null : c(v, p));
const isNull: Check = (v, p) => (v === null ? null : `${p} must be null`);

function exactObject(v: unknown, p: string, fields: Record<string, Check>): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return `${p} must be an object`;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in fields)) return `${p}.${k} is not part of the hosted snapshot`;
  for (const [k, check] of Object.entries(fields)) {
    if (!(k in o)) return `${p}.${k} is missing`;
    const err = check(o[k], `${p}.${k}`);
    if (err) return err;
  }
  return null;
}

const modelCheck: Check = (v, p) => exactObject(v, p, { requested: matches(TOKEN64, "a model id"), requestedId: matches(TOKEN64, "a model id"), actual: nullable(matches(TOKEN64, "a model id")), effort: nullable(matches(TOKEN32, "an effort token")) });
const lastRunCheck: Check = (v, p) => exactObject(v, p, {
  runId: matches(TOKEN64, "a run id"), outcome: matches(TOKEN32, "an outcome token"), model: matches(TOKEN64, "a model id"), actualModel: nullable(matches(TOKEN64, "a model id")),
  effort: nullable(matches(TOKEN32, "an effort token")), endedAt: nullable(isIso), objective: isNull, patchFiles: isInt(100000), agentsUsed: isInt(1000), skillsUsed: isInt(1000),
});
const usageCheck: Check = (v, p) => exactObject(v, p, {
  status: oneOf(USAGE_STATUS), resetAt: nullable(isIso),
  modelBlocks: (b, q) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return `${q} must be an object`;
    const entries = Object.entries(b as Record<string, unknown>);
    if (entries.length > 10) return `${q} has too many entries`;
    for (const [k, blk] of entries) {
      if (!TOKEN64.test(k)) return `${q} has a bad model key`;
      const err = exactObject(blk, `${q}.${k}`, { until: isIso, reason: matches(TOKEN32, "a reason token") });
      if (err) return err;
    }
    return null;
  },
});

export function validateHostedSnapshot(input: unknown, installId: string): { ok: true; snapshot: Snapshot } | { ok: false; error: string } {
  const err = exactObject(input, "snapshot", {
    v: (v, p) => (v === 1 ? null : `${p} must be 1`),
    at: isIso,
    seq: isInt(1e12),
    installId: (v, p) => (typeof v === "string" && v.toLowerCase() === installId.toLowerCase() ? null : `${p} is not this install`),
    channel: (v, p) => (v === "remote" ? null : `${p} must be "remote"`),
    supervisor: (v, p) => {
      const base = exactObject(v, p, {
        display: oneOf(DISPLAYS), state: matches(TOKEN40, "a state token"), enabled: isBool, launchAgentLoaded: isBool, paused: isBool, stopped: isBool,
        reason: nullable(oneOf(REASON_CODES)), model: nullable(modelCheck), currentTask: nullable(matches(TEXT120, "plain text ≤ 120 chars")),
        nextTask: nullable(matches(TEXT120, "plain text ≤ 120 chars")), taskSource: nullable(oneOf(TASK_SOURCES)), lastRun: nullable(lastRunCheck),
        usage: usageCheck, runsToday: isInt(100000), maxRunsPerDay: isInt(100000), nextCheckAt: nullable(isIso),
      });
      if (base) return base;
      const s = v as SupervisorSnapshot;
      if (s.taskSource !== "roy" && (s.currentTask !== null || s.nextTask !== null)) return `${p}.currentTask/nextTask are allowed only when taskSource is "roy"`;
      return null;
    },
  });
  return err ? { ok: false, error: err } : { ok: true, snapshot: input as Snapshot };
}
