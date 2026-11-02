import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { randomHex } from "../lib/continuous/crypto";
import { LINK_BODY_MAX, checkLinkRequest, linkMacString, signLinkRequest, verifyLinkRequest } from "../lib/continuous/linkAuth";
import { tmpStore } from "./helpers";

const installId = "0123456789abcdef";
const enc = new TextEncoder();

function signed(linkKey: string, route: "report" | "commands" | "ack", body: string, ts: number, nonce = randomHex(16)) {
  const bytes = enc.encode(body);
  return { headers: { ts: String(ts), nonce, sig: signLinkRequest(linkKey, installId, route, ts, nonce, bytes) }, body: bytes, nonce };
}

test("link MAC: 'v1\\n'+installId+'\\n'+ROUTE+'\\n'+ts+'\\n'+nonce+'\\n'+sha256hex(body)", () => {
  const key = randomHex(32), nonce = randomHex(16), body = enc.encode("{}");
  const literal = `v1\n${installId}\nreport\n1793462400\n${nonce}\n${createHash("sha256").update(body).digest("hex")}`;
  assert.equal(linkMacString(installId, "report", 1793462400, nonce, createHash("sha256").update(body).digest("hex")), literal);
  assert.equal(signLinkRequest(key, installId, "report", 1793462400, nonce, body), createHmac("sha256", Buffer.from(key, "hex")).update(literal).digest("hex"));
});

test("link request: a good request passes; bad signature, wrong route, tampered body and wrong install are refused", () => {
  const key = randomHex(32), now = 1793462400;
  const r = signed(key, "report", '{"v":1}', now);
  assert.equal(checkLinkRequest({ ...r, route: "report", installId, linkKeyHex: key, nowSec: now }).ok, true);
  assert.equal(checkLinkRequest({ ...r, route: "commands", installId, linkKeyHex: key, nowSec: now }).ok, false, "route is part of the MAC");
  assert.equal(checkLinkRequest({ ...r, body: enc.encode('{"v":2}'), route: "report", installId, linkKeyHex: key, nowSec: now }).ok, false, "body hash");
  assert.equal(checkLinkRequest({ ...r, route: "report", installId: "fedcba9876543210", linkKeyHex: key, nowSec: now }).ok, false, "installId");
  assert.equal(checkLinkRequest({ ...r, route: "report", installId, linkKeyHex: randomHex(32), nowSec: now }).ok, false, "other key");
  const bad = checkLinkRequest({ ...r, headers: { ...r.headers, sig: "0".repeat(64) }, route: "report", installId, linkKeyHex: key, nowSec: now });
  assert.equal(bad.ok, false); assert.equal((bad as { status: number }).status, 401);
  const malformed = checkLinkRequest({ ...r, headers: { ...r.headers, nonce: "xyz" }, route: "report", installId, linkKeyHex: key, nowSec: now });
  assert.equal((malformed as { status: number }).status, 400);
});

test("link request: clock skew beyond 60 s is refused either way", () => {
  const key = randomHex(32), now = 1793462400;
  const r = signed(key, "commands", "{}", now);
  assert.equal(checkLinkRequest({ ...r, route: "commands", installId, linkKeyHex: key, nowSec: now + 60 }).ok, true);
  assert.equal(checkLinkRequest({ ...r, route: "commands", installId, linkKeyHex: key, nowSec: now + 61 }).ok, false);
  assert.equal(checkLinkRequest({ ...r, route: "commands", installId, linkKeyHex: key, nowSec: now - 61 }).ok, false);
});

test("link request: oversize body is refused before any crypto", () => {
  const key = randomHex(32), now = 1793462400;
  const big = signed(key, "report", "x".repeat(LINK_BODY_MAX + 1), now);
  const v = checkLinkRequest({ ...big, route: "report", installId, linkKeyHex: key, nowSec: now });
  assert.equal(v.ok, false); assert.equal((v as { status: number }).status, 413);
  const edge = signed(key, "report", "x".repeat(LINK_BODY_MAX), now);
  assert.equal(checkLinkRequest({ ...edge, route: "report", installId, linkKeyHex: key, nowSec: now }).ok, true);
});

test("link request: a nonce is accepted once (durable SET NX), the replay is 409", async () => {
  const key = randomHex(32), now = 1793462400, store = tmpStore();
  const r = signed(key, "ack", '{"id":"x"}', now);
  const args = { ...r, route: "ack" as const, installId, linkKeyHex: key, nowSec: now, claimNonce: (n: string) => store.claimNonce(n) };
  assert.equal((await verifyLinkRequest(args)).ok, true);
  const replay = await verifyLinkRequest(args);
  assert.equal(replay.ok, false); assert.equal((replay as { status: number }).status, 409);
  const unsigned = await verifyLinkRequest({ ...args, headers: { ...r.headers, sig: "0".repeat(64) }, nonce: undefined } as never);
  assert.equal(unsigned.ok, false, "an unsigned request never claims a nonce");
  const other = (r.nonce[0] === "f" ? "e" : "f") + r.nonce.slice(1);           // always a different nonce (Sidebar R-3: was 1 in 16)
  assert.equal(await store.claimNonce(other), true, "other nonces are still free");
});
