import { ConfigError, loadKeys, type LinkKeys } from "./config";
import { randomHex } from "./crypto";
import { LinkStore } from "./linkStore";
import { isHosted } from "./mode";
import { verifyPasscode } from "./scrypt";
import { SESSION_MAX_SEC, clearSessionCookie, readCookie, serializeSessionCookie, sessionCookieName, signSessionId, verifySessionCookie } from "./session";
import { getStore } from "./store";
import { verifyTotp } from "./totp";

/**
 * Login, session and logout (contract v1.1 §Browser routes). Passphrase (scrypt) in both modes; a TOTP code as well
 * when hosted. Lockout: 5 FAILURES per 15 min per client → 15 min lock; a global pause once 50 failures land in an
 * hour. All counters, locks, TOTP step claims and session records live in the durable store — nothing in process
 * memory.
 *
 * Store budget and lockout resistance (DC-1): a login reads the store ONCE before the factors are checked (one MGET:
 * this client's lock and the global failure count). Only a FAILED attempt writes — its client counter, the lock when
 * that reaches 5, and the global counter. While the global pause is active a wrong attempt ends after that single read
 * with no write at all, so a flood cannot run up the bill; a RIGHT passphrase plus a fresh TOTP still signs in during
 * the pause (the pause stops failures, not Roy), subject only to that client's own lockout. Nothing here bounds the
 * CPU of scrypt per request: that is the Vercel Firewall rate-limit rule on /api/auth/login (README).
 */
export const LOGIN_PER_CLIENT = 5;
export const LOGIN_WINDOW_SEC = 15 * 60;
export const LOCKOUT_SEC = 15 * 60;
export const LOGIN_GLOBAL = 50;
export const LOGIN_GLOBAL_WINDOW_SEC = 3600;

export interface AuthContext { hosted: boolean; keys: LinkKeys; store: LinkStore }

/** Throws ConfigError (keys) or StoreError (no durable store) — both answered as 503 by the routes. */
export function authContext(hostHeader: string | null | undefined): AuthContext {
  const hosted = isHosted();
  const keys = loadKeys();
  return { hosted, keys, store: new LinkStore(getStore(hostHeader)) };
}

export interface SessionInfo { sid: string; csrf: string }

/** The sid of a cookie whose HMAC verifies — no store access. */
export function sidFromCookieHeader(cookieHeader: string | null, ctx: AuthContext): Promise<string | null> {
  return verifySessionCookie(readCookie(cookieHeader, sessionCookieName(ctx.hosted)), ctx.keys.sessionKey);
}

export async function sessionFromCookieHeader(cookieHeader: string | null, ctx: AuthContext, nowSec = Math.floor(Date.now() / 1000)): Promise<SessionInfo | null> {
  const sid = await sidFromCookieHeader(cookieHeader, ctx);
  if (!sid) return null;
  const rec = await ctx.store.getSession(sid, nowSec);
  return rec ? { sid, csrf: rec.csrf } : null;
}

export type LoginResult = { ok: true; setCookie: string } | { ok: false; status: number; error: string; retryAfterSec?: number };
const LOCKED: LoginResult = { ok: false, status: 429, error: "too many failed sign-ins; try again in 15 minutes", retryAfterSec: LOCKOUT_SEC };
const PAUSED: LoginResult = { ok: false, status: 429, error: "sign-in is paused for everyone for a while", retryAfterSec: LOGIN_GLOBAL_WINDOW_SEC };

export async function login(ctx: AuthContext, o: { passphrase: unknown; code: unknown; client: string; nowSec: number }): Promise<LoginResult> {
  const { store, keys, hosted } = ctx;
  const failBucket = `login:fail:${o.client}`;
  const gate = await store.loginGate(o.client);                 // the one read every attempt pays
  if (gate.locked) return LOCKED;
  const paused = gate.globalFails >= LOGIN_GLOBAL;

  // Both factors are always evaluated (no early exit), then combined.
  const passOk = await verifyPasscode(keys.passHash, o.passphrase);
  let step: number | null = null;
  let totpOk = true;
  if (hosted) { step = keys.totpSecret ? verifyTotp(keys.totpSecret, o.code, o.nowSec) : null; totpOk = step !== null; }
  let fresh = true;
  if (passOk && totpOk && hosted && step !== null) fresh = await store.claimTotpStep(step);   // a code is good once

  if (!(passOk && totpOk && fresh)) {
    if (paused) return PAUSED;                                   // no write: a paused flood costs one read per request
    const fails = await store.hit(failBucket, LOGIN_PER_CLIENT, LOGIN_WINDOW_SEC);
    if (fails.count >= LOGIN_PER_CLIENT) await store.lock(o.client, LOCKOUT_SEC);
    await store.hit("login:global", LOGIN_GLOBAL, LOGIN_GLOBAL_WINDOW_SEC);
    return { ok: false, status: 401, error: hosted ? "wrong passphrase or code" : "wrong passphrase" };
  }
  await store.clearHits(failBucket);
  const sid = randomHex(16);
  const csrf = randomHex(32);
  await store.createSession(sid, csrf, o.nowSec);
  const value = await signSessionId(sid, keys.sessionKey);
  return { ok: true, setCookie: serializeSessionCookie(sessionCookieName(hosted), value, { hosted, maxAgeSec: SESSION_MAX_SEC }) };
}

/** Deletes the record when the cookie verifies; always answers with a clearing cookie. */
export async function logout(cookieHeader: string | null, ctx: AuthContext): Promise<string> {
  const sid = await sidFromCookieHeader(cookieHeader, ctx);
  if (sid) await ctx.store.deleteSession(sid);
  return clearSessionCookie(sessionCookieName(ctx.hosted), ctx.hosted);
}

export { ConfigError };
