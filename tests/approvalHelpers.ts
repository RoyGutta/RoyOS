import type { LinkKeys } from "../lib/continuous/config";
import { hmacHex, randomHex } from "../lib/continuous/crypto";
import { signSessionId } from "../lib/continuous/session";
import { setSignerForTests } from "../lib/jarvis/approvalAuth";
import { setAuthContextForTests } from "../lib/jarvis/approvalSession";
import { tmpStore } from "./helpers";

/** What a real browser on the dashboard page sends: loopback Host, matching Origin, same-origin fetch, JSON. */
export const HOST = "127.0.0.1:4318";
export const BROWSER: Record<string, string> = { host: HOST, origin: `http://${HOST}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };

export interface ApprovalFixture {
  cookie: string; csrf: string; key: string; signed: string[];
  /** BROWSER plus Roy's session cookie and its X-CSRF. */
  withSession: Record<string, string>;
  /** A cookie signed with another key: its HMAC never verifies. */
  forgedCookie: string;
  teardown(): void;
}

/**
 * Roy's session in a temp store (keys generated here, never link.json) and a signer over a test key (never Roy's approval
 * secret). Every message the routes sign is recorded in `signed`, so a test can assert the exact scope string.
 */
export async function approvalFixture(): Promise<ApprovalFixture> {
  const keys: LinkKeys = { installId: randomHex(8), linkKey: randomHex(32), cmdKey: randomHex(32), passHash: "unused-by-these-tests", totpSecret: null, sessionKey: randomHex(32) };
  const store = tmpStore();
  setAuthContextForTests(() => ({ hosted: false, keys, store }));
  const sid = randomHex(16), csrf = randomHex(32);
  await store.createSession(sid, csrf, Math.floor(Date.now() / 1000));
  const cookie = `jarvis_session=${await signSessionId(sid, keys.sessionKey)}`;
  const forgedCookie = `jarvis_session=${await signSessionId(randomHex(16), randomHex(32))}`;
  const key = randomHex(32);
  const signed: string[] = [];
  setSignerForTests((m) => { signed.push(m); return hmacHex(key, m); });
  return { cookie, csrf, key, signed, forgedCookie, withSession: { ...BROWSER, cookie, "x-csrf": csrf }, teardown() { setAuthContextForTests(null); setSignerForTests(null); } };
}

export function post(url: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://${HOST}${url}`, { method: "POST", headers, body: JSON.stringify(body) });
}

export function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://${HOST}${url}`, { method: "GET", headers: { host: HOST, ...headers } });
}
