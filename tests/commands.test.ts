import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { buildCommand, commandMacString, verifyCommand } from "../lib/continuous/commands";
import { randomHex } from "../lib/continuous/crypto";

const installId = "0123456789abcdef";
const id = "9b2d7c1e-5f3a-4c8b-9e2f-1a2b3c4d5e6f";

test("command MAC: exactly 'cmd\\nv1\\n'+installId+'\\n'+channel+'\\n'+id+'\\n'+verb+'\\n'+issuedAt+'\\n'+expiresAt over the decoded key", () => {
  const cmdKey = randomHex(32);
  const c = buildCommand({ verb: "pause", channel: "remote", installId, cmdKeyHex: cmdKey, nowSec: 1793462400, id });
  assert.deepEqual({ ...c, sig: undefined }, { v: 1, installId, channel: "remote", id, verb: "pause", issuedAt: 1793462400, expiresAt: 1793462520, by: "roy", sig: undefined });
  const literal = "cmd\nv1\n0123456789abcdef\nremote\n9b2d7c1e-5f3a-4c8b-9e2f-1a2b3c4d5e6f\npause\n1793462400\n1793462520";
  assert.equal(commandMacString(c), literal);
  assert.equal(c.sig, createHmac("sha256", Buffer.from(cmdKey, "hex")).update(literal, "utf8").digest("hex"));
});

test("command verification (as the Mac does it): good, then installId / channel / tamper / expiry refusals", () => {
  const cmdKey = randomHex(32);
  const now = 1793462400;
  const local = buildCommand({ verb: "on", channel: "local", installId, cmdKeyHex: cmdKey, nowSec: now });
  assert.equal(verifyCommand(local, { cmdKeyHex: cmdKey, installId, channel: "local", nowSec: now + 5 }).ok, true);
  const r1 = verifyCommand(local, { cmdKeyHex: cmdKey, installId: "fedcba9876543210", channel: "local", nowSec: now });
  assert.equal(r1.ok, false); assert.match((r1 as { reason: string }).reason, /installId/);
  const r2 = verifyCommand(local, { cmdKeyHex: cmdKey, installId, channel: "remote", nowSec: now });
  assert.equal(r2.ok, false); assert.match((r2 as { reason: string }).reason, /channel/);
  assert.equal(verifyCommand({ ...local, verb: "stop" }, { cmdKeyHex: cmdKey, installId, channel: "local", nowSec: now }).ok, false, "verb changed after signing");
  assert.equal(verifyCommand({ ...local, channel: "remote" }, { cmdKeyHex: cmdKey, installId, channel: "remote", nowSec: now }).ok, false, "channel changed after signing");
  assert.equal(verifyCommand(local, { cmdKeyHex: randomHex(32), installId, channel: "local", nowSec: now }).ok, false, "other key");
  assert.equal(verifyCommand(local, { cmdKeyHex: cmdKey, installId, channel: "local", nowSec: now + 121 }).ok, false, "expired");
  assert.equal(verifyCommand(local, { cmdKeyHex: cmdKey, installId, channel: "local", nowSec: now - 31 }).ok, false, "issued in the future");
  assert.equal(verifyCommand({ ...local, v: 2 }, { cmdKeyHex: cmdKey, installId, channel: "local", nowSec: now }).ok, false, "wrong version");
  assert.throws(() => buildCommand({ verb: "start" as never, channel: "local", installId, cmdKeyHex: cmdKey }), /unknown verb/);
});
