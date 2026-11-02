import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { POST as contentPost } from "../app/api/content/action/route";
import { hmacHex } from "../lib/continuous/crypto";
import { setCliRunnerForTests, type CliScript } from "../lib/jarvis/cli";
import { BROWSER, approvalFixture, post, type ApprovalFixture } from "./approvalHelpers";

/** Sidebar G9-2 LOW (2026-11-02). Its own file (its own process): the content route's 30-per-minute limiter is per process. */
type Call = { script: CliScript; args: string[]; stdin: string | null };
const calls: Call[] = [];
let fx: ApprovalFixture;

before(async () => {
  fx = await approvalFixture();
  setCliRunnerForTests(async (script, args, stdin) => { calls.push({ script, args: [...args], stdin }); return { code: 0, out: JSON.stringify({ ok: true }) }; });
});
after(() => { fx.teardown(); setCliRunnerForTests(null); });
beforeEach(() => { calls.length = 0; fx.signed.length = 0; });

const nothingHappened = (label: string) => { assert.equal(fx.signed.length, 0, `${label}: signed nothing`); assert.equal(calls.length, 0, `${label}: ran nothing`); };

test("Sidebar LOW: actions that let something publish need the session (resume publisher, rights, move); stopping things does not", async () => {
  for (const body of [{ action: "pause", on: false }, { action: "rights", id: "cnt_abc123", state: "OWNED", note: "mine" },
                      { action: "queue", id: "cnt_abc123", at: "2030-01-07T15:00-05:00" }]) {
    for (const headers of [BROWSER, { ...fx.withSession, "x-csrf": "wrong" }]) {
      const res = await contentPost(post("/api/content/action", body, headers));
      assert.ok(res.status === 401 || res.status === 403, `${JSON.stringify(body)}: ${res.status}`);
    }
  }
  nothingHappened("enabling actions without a session");
  const res = await contentPost(post("/api/content/action", { action: "pause", on: false }, fx.withSession));
  assert.equal(res.status, 200); assert.deepEqual(calls.map((c) => c.args), [["pause", "off", "--by", "dashboard", "--auth-stdin"]]);
  calls.length = 0; fx.signed.length = 0;                                       // resuming signed one click (RC4-1)
  for (const body of [{ action: "pause", on: true }, { action: "reject", id: "cnt_abc123", note: "pulled" }]) {
    assert.equal((await contentPost(post("/api/content/action", body, BROWSER))).status, 200, JSON.stringify(body));   // stopping stays open
  }
  assert.deepEqual(calls.map((c) => c.args[0]), ["pause", "reject"]);
  assert.equal(fx.signed.length, 0);
});


test("Sidebar RC4-1: resuming, recording rights and setting a launch flag hand content_os.py one fresh signed click on stdin", async () => {
  const cases: [Record<string, unknown>, string, string[]][] = [
    [{ action: "pause", on: false }, "pause:off", ["pause", "off", "--by", "dashboard", "--auth-stdin"]],
    [{ action: "rights", id: "cnt_abc123", state: "OWNER", note: "I filmed it myself" }, "rights:cnt_abc123:OWNER",
      ["rights", "cnt_abc123", "OWNER", "--by", "dashboard", "--note", "I filmed it myself", "--auth-stdin"]],
    [{ action: "launch-flag", key: "syntheticMediaVerified", on: true, note: "label shows on the test video" }, "launch:syntheticMediaVerified:on",
      ["launch-flag", "syntheticMediaVerified", "on", "--by", "dashboard", "--note", "label shows on the test video", "--auth-stdin"]],
  ];
  for (const [body, scope, args] of cases) {
    calls.length = 0; fx.signed.length = 0;
    const res = await contentPost(post("/api/content/action", body, fx.withSession));
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(calls[0].args, args);
    const a = JSON.parse(calls[0].stdin ?? "null") as { sig: string; nonce: string; issuedAt: number };
    assert.match(a.nonce, /^[a-f0-9]{32}$/);
    assert.deepEqual(fx.signed, [`${scope}:${a.nonce}:${a.issuedAt}`]);
    assert.equal(a.sig, hmacHex(fx.key, fx.signed[0]));
  }
  // blocking directions sign nothing; an unknown flag is refused before anything runs
  calls.length = 0; fx.signed.length = 0;
  for (const body of [{ action: "rights", id: "cnt_abc123", state: "NOT_ALLOWED", note: "the owner objected" }, { action: "launch-flag", key: "auditPassed", on: false }]) {
    assert.equal((await contentPost(post("/api/content/action", body, fx.withSession))).status, 200);
  }
  assert.ok(calls.every((c) => c.stdin === null && !c.args.includes("--auth-stdin"))); assert.equal(fx.signed.length, 0);
  assert.equal((await contentPost(post("/api/content/action", { action: "launch-flag", key: "anything", on: true }, fx.withSession))).status, 400);
  assert.equal((await contentPost(post("/api/content/action", { action: "launch-flag", key: "auditPassed", on: true }, BROWSER))).status, 401);
});
