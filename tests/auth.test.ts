import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIN_GLOBAL, LOGIN_PER_CLIENT, login, logout, sessionFromCookieHeader, type AuthContext } from "../lib/continuous/auth";
import { totpCode } from "../lib/continuous/totp";
import { testKeys, tmpStore } from "./helpers";

const PASS = "correct horse battery staple";

async function ctx(hosted: boolean): Promise<AuthContext> {
  return { hosted, keys: await testKeys(PASS), store: tmpStore() };
}

test("login (local): passphrase alone; a session cookie that the status path accepts; logout revokes it", async () => {
  const c = await ctx(false);
  const now = 1_800_000_000;
  const bad = await login(c, { passphrase: "wrong", code: undefined, client: "local", nowSec: now });
  assert.equal(bad.ok, false); assert.equal((bad as { status: number }).status, 401);
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
  assert.equal(locked.ok, false); assert.equal((locked as { status: number }).status, 429);
  assert.equal((await login(c, { passphrase: PASS, code: undefined, client: "b", nowSec: now })).ok, true);
});

test("global cap: more than 50 attempts in an hour are refused for everyone", async () => {
  const c = await ctx(false);
  const now = 1_800_000_000;
  for (let i = 0; i < LOGIN_GLOBAL; i++) await login(c, { passphrase: "wrong", code: undefined, client: `c${i}`, nowSec: now });
  const r = await login(c, { passphrase: PASS, code: undefined, client: "fresh", nowSec: now });
  assert.equal(r.ok, false); assert.equal((r as { status: number }).status, 429);
});
