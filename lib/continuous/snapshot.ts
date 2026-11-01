/**
 * Snapshot v1 (contract v1.1 §Snapshots): the Mac's report of the supervisor. Pure module (client + server).
 *
 * The LOCAL snapshot (`link-status`) may carry session-written text; it never leaves the Mac. The HOSTED one is
 * restricted to fixed enums, counts, times, booleans and model ids (LP-3) and `validateHostedSnapshot` re-validates
 * that shape server-side, key by key, refusing anything else. It answers with a FRESHLY BUILT object holding only the
 * declared fields (never the parsed input), and every allow-list is a null-prototype object checked with
 * `Object.hasOwn`, so inherited names (`toString`, `constructor`, `__proto__`, …) are refused like any unknown key
 * (DC-2). Every dashboard renders every field as plain text.
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
type Result = { ok: true; value: unknown } | { ok: false; error: string };
type Check = (v: unknown, path: string) => Result;
type Fields = Record<string, Check>;
const good = (value: unknown): Result => ({ ok: true, value });
const bad = (error: string): Result => ({ ok: false, error });
/** A null-prototype allow-list: nothing is inherited, so `Object.hasOwn` is the whole membership test. */
const fields = (spec: Record<string, Check>): Fields => Object.assign(Object.create(null) as Fields, spec);

const TOKEN64 = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TOKEN40 = /^[A-Za-z0-9_-]{1,40}$/;
const TOKEN32 = /^[a-z][a-z0-9_]{0,31}$/;
const TEXT120 = /^[^\p{C}]{1,120}$/u;
/** RFC 3339 date-time (DC-9): date, `T`, time, optional fraction, and an offset — `Z`, `±HH:MM`, or the Mac's `±HHMM`. */
export const ISO_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)$/;
export function isIsoTime(v: unknown): v is string {
  return typeof v === "string" && v.length <= 40 && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v));
}

const isBool: Check = (v, p) => (typeof v === "boolean" ? good(v) : bad(`${p} must be a boolean`));
const isInt = (max: number): Check => (v, p) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? good(v) : bad(`${p} must be an integer 0..${max}`));
const isIso: Check = (v, p) => (isIsoTime(v) ? good(v) : bad(`${p} must be an RFC 3339 time`));
const matches = (re: RegExp, what: string): Check => (v, p) => (typeof v === "string" && re.test(v) ? good(v) : bad(`${p} must be ${what}`));
const oneOf = (list: readonly string[]): Check => (v, p) => (typeof v === "string" && list.includes(v) ? good(v) : bad(`${p} must be one of ${list.join("|")}`));
const nullable = (c: Check): Check => (v, p) => (v === null ? good(null) : c(v, p));
const isNull: Check = (v, p) => (v === null ? good(null) : bad(`${p} must be null`));
const is = (want: unknown): Check => (v, p) => (v === want ? good(v) : bad(`${p} must be ${JSON.stringify(want)}`));

/** Every own key must be declared, every declared key present and valid; the value is a fresh object of the declared keys only. */
function exactObject(v: unknown, p: string, allow: Fields): Result {
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad(`${p} must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!Object.hasOwn(allow, k)) return bad(`${p}.${k} is not part of the hosted snapshot`);
  const out: [string, unknown][] = [];
  for (const k of Object.keys(allow)) {
    if (!Object.hasOwn(o, k)) return bad(`${p}.${k} is missing`);
    const r = allow[k](o[k], `${p}.${k}`);
    if (!r.ok) return r;
    out.push([k, r.value]);
  }
  return good(Object.fromEntries(out));
}

const MODEL = fields({ requested: matches(TOKEN64, "a model id"), requestedId: matches(TOKEN64, "a model id"), actual: nullable(matches(TOKEN64, "a model id")), effort: nullable(matches(TOKEN32, "an effort token")) });
const LAST_RUN = fields({
  runId: matches(TOKEN64, "a run id"), outcome: matches(TOKEN32, "an outcome token"), model: matches(TOKEN64, "a model id"), actualModel: nullable(matches(TOKEN64, "a model id")),
  effort: nullable(matches(TOKEN32, "an effort token")), endedAt: nullable(isIso), objective: isNull, patchFiles: isInt(100000), agentsUsed: isInt(1000), skillsUsed: isInt(1000),
});
const BLOCK = fields({ until: isIso, reason: matches(TOKEN32, "a reason token") });
const modelBlocksCheck: Check = (b, q) => {
  if (!b || typeof b !== "object" || Array.isArray(b)) return bad(`${q} must be an object`);
  const entries = Object.entries(b as Record<string, unknown>);
  if (entries.length > 10) return bad(`${q} has too many entries`);
  const out: [string, unknown][] = [];
  for (const [k, blk] of entries) {
    if (!TOKEN64.test(k) || k in Object.prototype) return bad(`${q} has a bad model key`);
    const r = exactObject(blk, `${q}.${k}`, BLOCK);
    if (!r.ok) return r;
    out.push([k, r.value]);
  }
  return good(Object.fromEntries(out));
};
const USAGE = fields({ status: oneOf(USAGE_STATUS), resetAt: nullable(isIso), modelBlocks: modelBlocksCheck });
const SUPERVISOR = fields({
  display: oneOf(DISPLAYS), state: matches(TOKEN40, "a state token"), enabled: isBool, launchAgentLoaded: isBool, paused: isBool, stopped: isBool,
  reason: nullable(oneOf(REASON_CODES)), model: nullable((v, p) => exactObject(v, p, MODEL)), currentTask: nullable(matches(TEXT120, "plain text ≤ 120 chars")),
  nextTask: nullable(matches(TEXT120, "plain text ≤ 120 chars")), taskSource: nullable(oneOf(TASK_SOURCES)), lastRun: nullable((v, p) => exactObject(v, p, LAST_RUN)),
  usage: (v, p) => exactObject(v, p, USAGE), runsToday: isInt(100000), maxRunsPerDay: isInt(100000), nextCheckAt: nullable(isIso),
});
const supervisorCheck: Check = (v, p) => {
  const r = exactObject(v, p, SUPERVISOR);
  if (!r.ok) return r;
  const s = r.value as SupervisorSnapshot;
  if (s.taskSource !== "roy" && (s.currentTask !== null || s.nextTask !== null)) return bad(`${p}.currentTask/nextTask are allowed only when taskSource is "roy"`);
  return r;
};

export function validateHostedSnapshot(input: unknown, installId: string): { ok: true; snapshot: Snapshot } | { ok: false; error: string } {
  const r = exactObject(input, "snapshot", fields({
    v: is(1),
    at: isIso,
    seq: isInt(1e12),
    installId: (v, p) => (typeof v === "string" && v.toLowerCase() === installId.toLowerCase() ? good(v) : bad(`${p} is not this install`)),
    channel: is("remote"),
    supervisor: supervisorCheck,
  }));
  return r.ok ? { ok: true, snapshot: r.value as Snapshot } : { ok: false, error: r.error };
}
