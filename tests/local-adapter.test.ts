import assert from "node:assert/strict";
import { test } from "node:test";
import { NOT_INSTALLED, localApply, localStatus, sanitizeLocalSnapshot, setRunnerForTests, type RunResult } from "../lib/continuous/adapters/local";
import { buildCommand } from "../lib/continuous/commands";
import { randomHex } from "../lib/continuous/crypto";
import { hostedSnapshot } from "./helpers";

const installId = "0123456789abcdef";

test("local adapter: link-status output becomes the snapshot; the fake runner sees the fixed subcommand and no stdin", async () => {
  const calls: { sub: string; stdin: string | null }[] = [];
  setRunnerForTests(async (sub, stdin) => { calls.push({ sub, stdin }); return { code: 0, stdout: "noise\n" + JSON.stringify(hostedSnapshot(installId, { channel: "local" }, { reason: "Roy paused it at 11:02" })) + "\n", stderr: "" }; });
  try {
    const s = await localStatus();
    assert.equal(s.installed, true); assert.equal(s.error, null);
    assert.equal(s.snapshot?.supervisor.display, "running");
    assert.equal(s.snapshot?.supervisor.reason, "Roy paused it at 11:02", "local text is allowed");
    assert.ok(s.receivedAt && Date.now() - Date.parse(s.receivedAt) < 5000);
    assert.deepEqual(calls, [{ sub: "link-status", stdin: null }]);
  } finally { setRunnerForTests(null); }
});

test("local adapter: missing binary → 'Mac-side link not installed'; timeout and output cap are named", async () => {
  const cases: [RunResult, boolean, RegExp][] = [
    [{ code: null, stdout: "", stderr: "", errno: "ENOENT" }, false, new RegExp(NOT_INSTALLED.replace(/[()]/g, "\\$&"))],
    [{ code: null, stdout: "", stderr: "", errno: "TIMEOUT" }, true, /timed out after 10 s/],
    [{ code: null, stdout: "", stderr: "", errno: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }, true, /64 KB/],
    [{ code: 2, stdout: "", stderr: "usage: supervisor.py ... invalid choice: 'link-status'" }, false, /no link-status yet/],
    [{ code: 1, stdout: "", stderr: "Traceback" }, true, /failed \(exit 1\)/],
    [{ code: 0, stdout: "not json", stderr: "" }, true, /printed no snapshot/],
  ];
  for (const [result, installed, re] of cases) {
    setRunnerForTests(async () => result);
    try {
      const s = await localStatus();
      assert.equal(s.installed, installed, JSON.stringify(result));
      assert.equal(s.snapshot, null);
      assert.match(s.error ?? "", re);
    } finally { setRunnerForTests(null); }
  }
});

test("local adapter: link-apply gets the signed command on stdin and returns the Mac's answer", async () => {
  const cmd = buildCommand({ verb: "pause", channel: "local", installId, cmdKeyHex: randomHex(32) });
  let seen: { sub: string; stdin: string | null } | null = null;
  setRunnerForTests(async (sub, stdin) => { seen = { sub, stdin }; return { code: 0, stdout: JSON.stringify({ id: cmd.id, ok: true, message: "paused", snapshot: hostedSnapshot(installId, { channel: "local" }, { display: "paused", paused: true }) }), stderr: "" }; });
  try {
    const r = await localApply(cmd);
    assert.deepEqual(seen, { sub: "link-apply", stdin: JSON.stringify(cmd) });
    assert.equal(r.ok, true); assert.equal(r.message, "paused"); assert.equal(r.snapshot?.supervisor.display, "paused");
  } finally { setRunnerForTests(null); }
  setRunnerForTests(async () => ({ code: 0, stdout: JSON.stringify({ id: cmd.id, ok: false, message: "run `supervisor.py start` in Terminal once" }), stderr: "" }));
  try { const r = await localApply(cmd); assert.equal(r.ok, false); assert.match(r.message, /supervisor.py start/); } finally { setRunnerForTests(null); }
  setRunnerForTests(async () => ({ code: null, stdout: "", stderr: "", errno: "ENOENT" }));
  try { const r = await localApply(cmd); assert.equal(r.ok, false); assert.equal(r.message, NOT_INSTALLED); } finally { setRunnerForTests(null); }
});

test("local snapshot sanitizer: enforces types and caps text; control characters are blanked", () => {
  const s = sanitizeLocalSnapshot({ v: 1, at: "2026-10-31T12:00:00Z", seq: "x", supervisor: { display: "running", enabled: "true", currentTask: "a\u0007b" + "x".repeat(300), usage: { status: "weird" }, runsToday: -3 } });
  assert.ok(s);
  assert.equal(s.supervisor.enabled, false, "a string is not true");
  assert.equal(s.supervisor.currentTask?.length, 200);
  assert.ok(!s.supervisor.currentTask?.includes("\u0007"));
  assert.equal(s.supervisor.usage.status, "unknown");
  assert.equal(s.supervisor.runsToday, 0);
  assert.equal(sanitizeLocalSnapshot({ v: 2 }), null);
});
