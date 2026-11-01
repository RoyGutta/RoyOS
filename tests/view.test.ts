import assert from "node:assert/strict";
import { test } from "node:test";
import { QUEUED_TEXT, lastCommandView, lastStateLabel, type SentCommand, type StatusPayload } from "../lib/continuous/view";

type Recent = StatusPayload["recent"][number];
const done = (id: string, ok: boolean | null, message: string | null, status = "done", ackedAt: string | null = "2026-10-31T12:00:00Z"): Recent => ({ id, verb: "on", ok, message, ackedAt, status });

test("DC-6: a queued hosted command is shown as queued — never ok — until the Mac's ack for that id arrives, and the Mac's refusal then replaces it", () => {
  const sent: SentCommand = { id: "cmd-1", verb: "on", outcome: "queued", message: "queued; the Mac applies it on its next pull (≤ 30 s)", at: 1000 };
  const queued = lastCommandView(sent, { pending: [{ id: "cmd-1", verb: "on", issuedAt: 1 }], recent: [] });
  assert.deepEqual(queued, { verb: "on", state: "queued", message: QUEUED_TEXT, at: 1000 });
  assert.equal(lastStateLabel("queued"), "queued");
  const stillQueued = lastCommandView(sent, { pending: [], recent: [done("cmd-0", true, "an older command's success")] });
  assert.equal(stillQueued?.state, "queued", "another command's result never stands in for this one");
  const refused = lastCommandView(sent, { pending: [], recent: [done("cmd-0", true, "older"), done("cmd-1", false, "run `supervisor.py start` in Terminal once")] });
  assert.equal(refused?.state, "refused"); assert.match(refused?.message ?? "", /supervisor\.py start/); assert.equal(refused?.at, Date.parse("2026-10-31T12:00:00Z"));
  const applied = lastCommandView(sent, { pending: [], recent: [done("cmd-1", true, "enabled")] });
  assert.equal(applied?.state, "ok"); assert.equal(applied?.message, "enabled");
  const expired = lastCommandView(sent, { pending: [], recent: [done("cmd-1", false, "expired before the Mac pulled it", "expired", null)] });
  assert.equal(expired?.state, "expired"); assert.equal(expired?.at, null);
});

test("DC-6: a local command shows its own synchronous result; with nothing sent, the newest result; nothing at all → null", () => {
  assert.deepEqual(lastCommandView({ id: "c", verb: "pause", outcome: "ok", message: "paused", at: 5 }, { pending: [], recent: [] }), { verb: "pause", state: "ok", message: "paused", at: 5 });
  assert.deepEqual(lastCommandView({ id: "c", verb: "pause", outcome: "refused", message: "HTTP 409", at: 5 }, null), { verb: "pause", state: "refused", message: "HTTP 409", at: 5 });
  assert.deepEqual(lastCommandView({ id: null, verb: "stop", outcome: "failed", message: "request failed", at: 5 }, { pending: [], recent: [done("x", true, "y")] }), { verb: "stop", state: "refused", message: "request failed", at: 5 });
  assert.equal(lastCommandView(null, { pending: [], recent: [done("x", true, "y"), done("w", false, "z")] })?.message, "y");
  assert.equal(lastCommandView(null, { pending: [], recent: [done("x", null, null, "pending", null)] })?.state, "pending");
  assert.equal(lastCommandView(null, { pending: [], recent: [] }), null);
  assert.equal(lastCommandView(null, null), null);
});
