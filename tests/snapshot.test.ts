import assert from "node:assert/strict";
import { test } from "node:test";
import { isIsoTime, onlineFrom, validateHostedSnapshot } from "../lib/continuous/snapshot";
import { toggleState } from "../lib/continuous/view";
import type { Snapshot } from "../lib/continuous/snapshot";
import { hostedSnapshot } from "./helpers";

const installId = "0123456789abcdef";
const err = (x: unknown) => { const v = validateHostedSnapshot(x, installId); assert.equal(v.ok, false, "expected a rejection"); return (v as { error: string }).error; };

test("offline detection: < 60 s online, ≥ 60 s offline, missing → unknown; the toggle never shows running when stale", () => {
  const now = Date.parse("2026-10-31T12:01:00Z");
  assert.deepEqual(onlineFrom(new Date(now - 59_000).toISOString(), now), { online: true, ageSec: 59 });
  assert.equal(onlineFrom(new Date(now - 60_000).toISOString(), now).online, false);
  assert.equal(onlineFrom(new Date(now - 61_000).toISOString(), now).online, false);
  assert.deepEqual(onlineFrom(null, now), { online: false, ageSec: null });
  assert.deepEqual(onlineFrom("not a time", now), { online: false, ageSec: null });
  const snap = hostedSnapshot(installId) as unknown as Snapshot;
  assert.equal(toggleState(true, snap), "on");
  assert.equal(toggleState(false, snap), "unknown", "stale report → UNKNOWN even though the snapshot says running");
  assert.equal(toggleState(true, null), "unknown");
  assert.equal(toggleState(true, { ...snap, supervisor: { ...snap.supervisor, enabled: false, display: "disabled" } }), "off");
  assert.equal(toggleState(true, { ...snap, supervisor: { ...snap.supervisor, display: "stopped", stopped: true } }), "off");
  assert.equal(toggleState(true, { ...snap, supervisor: { ...snap.supervisor, display: "paused", paused: true } }), "on", "paused is still on");
});

test("hosted snapshot re-validation: the contract shape passes", () => {
  const v = validateHostedSnapshot(hostedSnapshot(installId), installId);
  assert.equal(v.ok, true, (v as { error?: string }).error);
  const idle = validateHostedSnapshot(hostedSnapshot(installId, {}, { model: null, currentTask: null, nextTask: null, taskSource: "checkpoint", lastRun: null, reason: "limit", usage: { status: "limited", resetAt: "2026-10-31T15:00:00Z", modelBlocks: { fable: { until: "2026-10-31T15:00:00Z", reason: "usage_limit" } } } }), installId);
  assert.equal(idle.ok, true, (idle as { error?: string }).error);
});

test("hosted snapshot re-validation: text where only codes are allowed, unknown keys and wrong channel are rejected", () => {
  assert.match(err(hostedSnapshot(installId, {}, { lastRun: { runId: "run_01", outcome: "completed", model: "fable", actualModel: null, effort: "high", endedAt: null, objective: "Refactor the ledger", patchFiles: 0, agentsUsed: 0, skillsUsed: 0 } })), /objective/);
  assert.match(err(hostedSnapshot(installId, {}, { reason: "the session hit a wall" })), /reason/);
  assert.match(err(hostedSnapshot(installId, {}, { reason: "roy_pausedx" })), /reason/);
  assert.match(err(hostedSnapshot(installId, {}, { currentTask: "secret handoff text", taskSource: "checkpoint" })), /currentTask/);
  assert.match(err(hostedSnapshot(installId, {}, { currentTask: "x".repeat(121) })), /currentTask/);
  assert.match(err(hostedSnapshot(installId, {}, { currentTask: "line1\nline2" })), /currentTask/);
  assert.match(err(hostedSnapshot(installId, {}, { transcript: "…" })), /transcript/);
  assert.match(err(hostedSnapshot(installId, { channel: "local" })), /channel/);
  assert.match(err(hostedSnapshot(installId, { installId: "fedcba9876543210" })), /installId/);
  assert.match(err(hostedSnapshot(installId, { v: 2 })), /v must be 1/);
  assert.match(err(hostedSnapshot(installId, {}, { display: "exploding" })), /display/);
  assert.match(err(hostedSnapshot(installId, {}, { enabled: "yes" })), /enabled/);
  assert.match(err(hostedSnapshot(installId, {}, { model: { requested: "fable", requestedId: "claude-fable-5-1", actual: "claude-fable-5-1", effort: "high", note: "x" } })), /model\.note/);
  const { usage: _u, ...missing } = hostedSnapshot(installId).supervisor as Record<string, unknown>;
  void _u;
  assert.match(err({ ...hostedSnapshot(installId), supervisor: missing }), /usage is missing/);
  assert.match(err("string"), /object/);
});

/** The snapshot with one extra OWN key (as JSON.parse would create it, `__proto__` included) carrying session text. */
function withKey(path: string[], key: string): Record<string, unknown> {
  const j = JSON.parse(JSON.stringify(hostedSnapshot(installId, {}, { usage: { status: "ok", resetAt: null, modelBlocks: { fable: { until: "2026-10-31T15:00:00Z", reason: "usage_limit" } } } })));
  let t = j;
  for (const p of path) t = t[p];
  Object.defineProperty(t, key, { value: "SESSION TEXT that must never reach the store", enumerable: true, writable: true, configurable: true });
  return j;
}
const INHERITED = ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"];

test("DC-2: inherited-name keys carrying text are refused at every level, and the stored snapshot is a fresh object of declared fields only", () => {
  const levels: [string, string[]][] = [["snapshot", []], ["supervisor", ["supervisor"]], ["model", ["supervisor", "model"]], ["lastRun", ["supervisor", "lastRun"]], ["usage", ["supervisor", "usage"]], ["modelBlocks.fable", ["supervisor", "usage", "modelBlocks", "fable"]]];
  for (const [name, path] of levels) for (const key of INHERITED) {
    const e = err(withKey(path, key));
    assert.match(e, /is not part of the hosted snapshot/, `${name}.${key}: ${e}`);
    assert.ok(e.includes(key), `${name}.${key} is named: ${e}`);
  }
  assert.match(err(JSON.parse('{"__proto__":"text","v":1}')), /__proto__/, "straight off the wire");
  for (const key of ["toString", "constructor", "__proto__"]) assert.match(err(withKey(["supervisor", "usage", "modelBlocks"], key)), /bad model key/, `modelBlocks key ${key}`);
  assert.match(err(hostedSnapshot(installId, {}, { usage: { status: "ok", resetAt: null, modelBlocks: { fable: { until: "2026-10-31T15:00:00Z", reason: "usage_limit", toString: "x" } } } })), /modelBlocks\.fable\.toString/);

  const input = hostedSnapshot(installId);
  const v = validateHostedSnapshot(input, installId);
  assert.equal(v.ok, true);
  const out = (v as { snapshot: Snapshot }).snapshot;
  assert.notEqual(out, input, "never the parsed input itself");
  assert.notEqual(out.supervisor, input.supervisor);
  assert.notEqual(out.supervisor.lastRun, (input.supervisor as Snapshot["supervisor"]).lastRun);
  assert.deepEqual(out, input, "same declared content");
  assert.deepEqual(Object.keys(out), ["v", "at", "seq", "installId", "channel", "supervisor"]);
  assert.deepEqual(Object.keys(out.supervisor.usage), ["status", "resetAt", "modelBlocks"]);
  (input.supervisor as Record<string, unknown>).currentTask = "changed after validation";
  assert.equal(out.supervisor.currentTask, "Ship the relay", "the stored object does not alias the input");
});

test("DC-9: time fields must be RFC 3339 — not anything Date.parse happens to accept", () => {
  for (const ok of ["2026-10-31T12:00:00Z", "2026-10-31T12:00:00.123456+00:00", "2026-10-31T08:00:00-0400", "2026-10-31T08:00:00.5-04:00", "2026-12-31T23:59:59Z"]) assert.equal(isIsoTime(ok), true, ok);
  for (const bad of ["hello 12", "12", "2026-10-31", "2026-10-31 12:00:00", "2026-10-31T12:00:00", "2026-13-01T00:00:00Z", "2026-10-32T00:00:00Z", "Tue Nov 1 2026", "2026-10-31T12:00:00Z text", "2026-10-31T24:00:00Z", "", 12, null]) assert.equal(isIsoTime(bad), false, String(bad));
  assert.match(err(hostedSnapshot(installId, { at: "hello 12" })), /snapshot\.at must be an RFC 3339 time/);
  assert.match(err(hostedSnapshot(installId, {}, { nextCheckAt: "2026-10-31" })), /nextCheckAt/);
  assert.equal(validateHostedSnapshot(hostedSnapshot(installId, { at: "2026-10-31T08:05:00-0400" }), installId).ok, true, "the Mac's strftime %z offset");
});
