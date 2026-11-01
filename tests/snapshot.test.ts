import assert from "node:assert/strict";
import { test } from "node:test";
import { onlineFrom, validateHostedSnapshot } from "../lib/continuous/snapshot";
import { toggleState } from "../lib/continuous/view";
import type { Snapshot } from "../lib/continuous/snapshot";
import { hostedSnapshot } from "./helpers";

const installId = "0123456789abcdef";

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
  const err = (x: unknown) => { const v = validateHostedSnapshot(x, installId); assert.equal(v.ok, false); return (v as { error: string }).error; };
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
