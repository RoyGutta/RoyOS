import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAckBody, parseCommandsBody } from "../lib/continuous/linkBodies";

const id = "9b2d7c1e-5f3a-4c8b-9e2f-1a2b3c4d5e6f";
const bad = <T>(r: { ok: true; body: T } | { ok: false; error: string }) => { assert.equal(r.ok, false); return (r as { error: string }).error; };

test("DC-9: an ack is exactly {id, ok, message?} — unknown keys, inherited names and __proto__ are refused, not ignored", () => {
  assert.deepEqual(parseAckBody({ id, ok: true, message: "paused" }), { ok: true, body: { id, ok: true, message: "paused" } });
  assert.deepEqual(parseAckBody({ id, ok: false }), { ok: true, body: { id, ok: false, message: null } });
  assert.deepEqual(parseAckBody({ id, ok: false, message: null }), { ok: true, body: { id, ok: false, message: null } });
  assert.match(bad(parseAckBody({ id, ok: true, message: "x", extra: 1 })), /extra is not part of an ack/);
  assert.match(bad(parseAckBody({ id, ok: true, snapshot: {} })), /snapshot/);
  assert.match(bad(parseAckBody(JSON.parse(`{"id":"${id}","ok":true,"__proto__":"text"}`))), /__proto__/);
  assert.match(bad(parseAckBody(JSON.parse(`{"id":"${id}","ok":true,"toString":"text"}`))), /toString/);
  assert.match(bad(parseAckBody({ id: "not-a-uuid", ok: true })), /uuid/);
  assert.match(bad(parseAckBody({ id, ok: "true" })), /ok must be a boolean/);
  assert.match(bad(parseAckBody({ id, ok: true, message: "x".repeat(121) })), /120/);
  assert.match(bad(parseAckBody({ id, ok: true, message: 7 })), /120/);
  assert.match(bad(parseAckBody({ ok: true })), /id/);
  assert.match(bad(parseAckBody([id])), /object/);
  assert.match(bad(parseAckBody(null)), /object/);
  assert.match(bad(parseAckBody("x")), /object/);
});

test("DC-9: the commands pull body is exactly {} — any key is refused", () => {
  assert.deepEqual(parseCommandsBody({}), { ok: true, body: {} });
  assert.match(bad(parseCommandsBody({ x: 1 })), /x is not part of a commands pull/);
  assert.match(bad(parseCommandsBody(JSON.parse('{"__proto__":{}}'))), /__proto__/);
  assert.match(bad(parseCommandsBody([])), /object/);
  assert.match(bad(parseCommandsBody(null)), /object/);
});
