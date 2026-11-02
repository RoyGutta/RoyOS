import assert from "node:assert/strict";
import { test } from "node:test";
import { randomHex } from "../lib/continuous/crypto";
import { SESSION_TTL_SEC } from "../lib/continuous/linkStore";
import { SESSION_MAX_SEC, clearSessionCookie, readCookie, serializeSessionCookie, sessionCookieName, signSessionId, verifySessionCookie } from "../lib/continuous/session";
import { tmpStore } from "./helpers";

test("session cookie: signs and verifies; tampering with the sid or the signature fails", async () => {
  const key = randomHex(32), sid = randomHex(16);
  const value = await signSessionId(sid, key);
  assert.equal(await verifySessionCookie(value, key), sid);
  const [s, sig] = value.split(".");
  const flippedSid = (s[0] === "a" ? "b" : "a") + s.slice(1);
  assert.equal(await verifySessionCookie(`${flippedSid}.${sig}`, key), null);
  const flippedSig = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(await verifySessionCookie(`${s}.${flippedSig}`, key), null);
  // the last of 43 base64url characters carries 2 spare bits: a spelling that differs only there decodes to the same MAC
  // bytes and must still be refused (this was the intermittent failure of the flip above, 2026-11-02)
  const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const spare = sig.slice(0, -1) + ALPH[ALPH.indexOf(sig[sig.length - 1]) ^ 1];
  assert.equal(await verifySessionCookie(`${s}.${spare}`, key), null, "non-canonical signature spelling");
  assert.equal(await verifySessionCookie(value, randomHex(32)), null, "another key");
  assert.equal(await verifySessionCookie(s, key), null, "no signature");
  assert.equal(await verifySessionCookie("", key), null);
});

test("session record: expires after 12 h and a stretched record is refused", async () => {
  const store = tmpStore();
  const sid = randomHex(16);
  await store.createSession(sid, randomHex(32), 1_000_000);
  assert.ok(await store.getSession(sid, 1_000_000 + SESSION_TTL_SEC - 1));
  assert.equal(await store.getSession(sid, 1_000_000 + SESSION_TTL_SEC), null);
  await store.deleteSession(sid);
  assert.equal(await store.getSession(sid, 1_000_001), null, "logout deletes the record");
  assert.equal(SESSION_TTL_SEC, SESSION_MAX_SEC);
});

test("session cookie attributes: HttpOnly, SameSite=Strict, Secure + __Host- when hosted, 12 h max", () => {
  const hosted = serializeSessionCookie(sessionCookieName(true), "x.y", { hosted: true, maxAgeSec: 99_999 });
  assert.match(hosted, /^__Host-jarvis_session=x\.y; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  const local = serializeSessionCookie(sessionCookieName(false), "x.y", { hosted: false, maxAgeSec: 3600 });
  assert.match(local, /^jarvis_session=x\.y; Path=\/; HttpOnly; SameSite=Strict; Max-Age=3600$/);
  assert.match(clearSessionCookie(sessionCookieName(true), true), /Max-Age=0; Secure$/);
  assert.equal(readCookie("a=1; __Host-jarvis_session=abc.def; b=2", "__Host-jarvis_session"), "abc.def");
  assert.equal(readCookie("a=1", "jarvis_session"), null);
});
