import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCKOUT_SEC, LOGIN_GLOBAL, LOGIN_GLOBAL_WINDOW_SEC, LOGIN_PER_CLIENT, login, logout, sessionFromCookieHeader, type AuthContext, type LoginResult } from "../lib/continuous/auth";
import { clientBucket } from "../lib/continuous/http";
import { LinkStore } from "../lib/continuous/linkStore";
import { totpCode } from "../lib/continuous/totp";
import { countingKV, testKeys, tmpKV, tmpStore } from "./helpers";

const PASS = "correct horse battery staple";
const status = (r: LoginResult) => (r.ok ? 200 : r.status);
const retryAfter = (r: LoginResult) => (r.ok ? null : r.retryAfterSec ?? null);

async function ctx(hosted: boolean): Promise<AuthContext> {
  return { hosted, keys: await testKeys(PASS), store: tmpStore() };
}

test("login (local): passphrase alone; a session cookie that the status path accepts; logout revokes it", async () => {
  const c = await ctx(false);
  const now = 1_800_000_000;
  const bad = await login(c, { passphrase: "wrong", code: undefined, client: "local", nowSec: now });
  assert.equal(bad.ok, false); assert.equal(status(bad), 401);
  const good = await login(c, { passphrase: PASS, code: undefined, client: "local", nowSec: now });
  assert.equal(good.ok, true);
  const cookie = (good as { setCookie: string }).setCookie;
  assert.match(cookie, /^jarvis_session=[a-f0-9]{32}\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  const header = cookie.split(";")[0];
  const s = await sessionFromCookieHeader(header, c, now + 10);
  assert.ok(s && /^[a-f0-9]{64}$/.test(s.csrf));
  assert.equal(await sessionFromCookieHeader(header, c, now + 12 * 3600), null, "expired after 12 h");
  await logout(header, c);
  assert.equal(await sessionFromCookieHeader(header, c, now + 10), null, "revoked on logout");
});

test("login (hosted): passphrase AND a fresh TOTP code; __Host- cookie; a reused code is refused", async () => {
  const c = await ctx(true);
  const now = 1_800_000_000;
  const code = totpCode(c.keys.totpSecret!, now);
  const noCode = await login(c, { passphrase: PASS, code: "000000", client: "203.0.113.9", nowSec: now });
  assert.equal(noCode.ok, false);
  const wrongPass = await login(c, { passphrase: "nope", code, client: "203.0.113.9", nowSec: now });
  assert.equal(wrongPass.ok, false);
  const ok = await login(c, { passphrase: PASS, code, client: "203.0.113.9", nowSec: now });
  assert.equal(ok.ok, true);
  assert.match((ok as { setCookie: string }).setCookie, /^__Host-jarvis_session=.*; Secure$/);
  const replay = await login(c, { passphrase: PASS, code, client: "203.0.113.9", nowSec: now + 5 });
  assert.equal(replay.ok, false, "same code within its step");
  const next = await login(c, { passphrase: PASS, code: totpCode(c.keys.totpSecret!, now + 30), client: "203.0.113.9", nowSec: now + 30 });
  assert.equal(next.ok, true, "the next step's code is new");
});

test("lockout: 5 failures per client lock that client for 15 min even with the right passphrase; another client is unaffected", async () => {
  const c = await ctx(false);
  const now = 1_800_000_000;
  for (let i = 0; i < LOGIN_PER_CLIENT; i++) assert.equal((await login(c, { passphrase: "wrong", code: undefined, client: "a", nowSec: now })).ok, false);
  const locked = await login(c, { passphrase: PASS, code: undefined, client: "a", nowSec: now });
  assert.equal(locked.ok, false); assert.equal(status(locked), 429);
  assert.equal((await login(c, { passphrase: PASS, code: undefined, client: "b", nowSec: now })).ok, true);
});

test("DC-1: IPv6 clients share a /64 bucket; only failures count; the global pause costs a junk request one store read and no write, and still admits the right passphrase + TOTP", async () => {
  const counted = countingKV(tmpKV());
  const keys = await testKeys(PASS);
  const c: AuthContext = { hosted: true, keys, store: new LinkStore(counted.kv) };
  const now = 1_800_000_000;
  // `net` picks the /64, `host` varies the interface id inside it: each address is a different client IP, one bucket per /64.
  const addr = (net: number, host: number) => `2001:db8:${net.toString(16)}:1:${host.toString(16)}::7`;
  const junk = (ip: string, passphrase: unknown = "") => login(c, { passphrase, code: "000000", client: clientBucket(ip), nowSec: now });
  const globalCount = async () => Number(await counted.kv.get("rl:login:global")) || 0;

  // 35 junk logins from 7 /64s (5 addresses each): every /64 is locked after its 5th failure, the global count is 35, no pause.
  for (let net = 1; net <= 7; net++) for (let host = 1; host <= 5; host++) assert.equal(status(await junk(addr(net, host))), 401, `net ${net} host ${host}`);
  const sixth = await junk(addr(1, 6));
  assert.equal(status(sixth), 429); assert.equal(retryAfter(sixth), LOCKOUT_SEC, "a sixth address in a locked /64 shares that lockout");
  assert.equal(await globalCount(), 35);
  assert.equal(status(await junk(addr(8, 1))), 401, "35 failures: no global pause yet");

  // 14 more failures (nets 8–10) reach the global cap of 50.
  for (let host = 2; host <= 5; host++) assert.equal(status(await junk(addr(8, host))), 401);
  for (let net = 9; net <= 10; net++) for (let host = 1; host <= 5; host++) assert.equal(status(await junk(addr(net, host))), 401);
  assert.equal(await globalCount(), LOGIN_GLOBAL);

  // Paused: a junk request (a real wrong passphrase, scrypt and all) costs exactly ONE store read and writes nothing.
  counted.calls.length = 0;
  const paused = await junk(addr(11, 1), "not the passphrase");
  assert.equal(status(paused), 429); assert.equal(retryAfter(paused), LOGIN_GLOBAL_WINDOW_SEC);
  assert.deepEqual(counted.calls, ["mget"], "one read, no write");
  assert.equal(await globalCount(), LOGIN_GLOBAL, "a paused failure is not counted");

  // Roy still signs in from a fresh /64 with the right passphrase and a fresh TOTP …
  const roy = await login(c, { passphrase: PASS, code: totpCode(keys.totpSecret!, now), client: clientBucket(addr(12, 1)), nowSec: now });
  assert.equal(roy.ok, true, "the pause stops failures, not Roy");
  assert.equal(await globalCount(), LOGIN_GLOBAL, "a success is never counted");
  // … but his own client's backoff still applies, and the pause is still on for everyone else.
  const royLocked = await login(c, { passphrase: PASS, code: totpCode(keys.totpSecret!, now + 30), client: clientBucket(addr(1, 7)), nowSec: now + 30 });
  assert.equal(status(royLocked), 429); assert.equal(retryAfter(royLocked), LOCKOUT_SEC);
  assert.equal(status(await junk(addr(13, 1))), 429);
  assert.equal(retryAfter(await junk(addr(13, 2))), LOGIN_GLOBAL_WINDOW_SEC);
});
