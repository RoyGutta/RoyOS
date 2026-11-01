import { HEX32, HEX64, hmacHex, safeEqual, sha256Hex } from "./crypto";

/**
 * Relay request authentication (contract v1.1 §Relay API). Every Mac request carries X-Link-Ts, X-Link-Nonce and
 *   X-Link-Sig = hex HMAC-SHA256(LINK_KEY, 'v1\n'+installId+'\n'+ROUTE+'\n'+ts+'\n'+nonce+'\n'+sha256hex(body)).
 * Refused when |now − ts| > 60, the nonce was seen within 10 min, the body exceeds 16 KB, or the MAC is wrong. The
 * pure part (size, skew, format, signature) runs before the nonce is claimed in the store, so an unsigned flood cannot
 * fill the nonce set.
 */
export const LINK_ROUTES = ["report", "commands", "ack"] as const;
export type LinkRoute = (typeof LINK_ROUTES)[number];
export const LINK_BODY_MAX = 16 * 1024;
export const LINK_SKEW_SEC = 60;
export const NONCE_TTL_SEC = 600;

export interface LinkHeaders { ts: string | null; nonce: string | null; sig: string | null }

export function readLinkHeaders(h: Headers): LinkHeaders {
  return { ts: h.get("x-link-ts"), nonce: h.get("x-link-nonce"), sig: h.get("x-link-sig") };
}

export function linkMacString(installId: string, route: LinkRoute, ts: number, nonce: string, bodySha256Hex: string): string {
  return `v1\n${installId}\n${route}\n${ts}\n${nonce}\n${bodySha256Hex}`;
}

/** What the Mac computes. Used by tests and the hosted end-to-end script. */
export function signLinkRequest(linkKeyHex: string, installId: string, route: LinkRoute, ts: number, nonce: string, body: Uint8Array): string {
  return hmacHex(linkKeyHex, linkMacString(installId, route, ts, nonce, sha256Hex(body)));
}

export type LinkVerdict = { ok: true; ts: number; nonce: string } | { ok: false; status: number; error: string };

export function checkLinkRequest(o: { headers: LinkHeaders; route: LinkRoute; body: Uint8Array; installId: string; linkKeyHex: string; nowSec: number }): LinkVerdict {
  if (o.body.byteLength > LINK_BODY_MAX) return { ok: false, status: 413, error: "body exceeds 16 KB" };
  const { ts: tsRaw, nonce, sig } = o.headers;
  if (!tsRaw || !/^\d{1,12}$/.test(tsRaw)) return { ok: false, status: 400, error: "X-Link-Ts must be unix seconds" };
  if (!nonce || !HEX32.test(nonce)) return { ok: false, status: 400, error: "X-Link-Nonce must be 32 hex" };
  if (!sig || !HEX64.test(sig)) return { ok: false, status: 401, error: "X-Link-Sig missing or malformed" };
  const ts = Number(tsRaw);
  if (Math.abs(o.nowSec - ts) > LINK_SKEW_SEC) return { ok: false, status: 401, error: "clock skew exceeds 60 s" };
  const expected = hmacHex(o.linkKeyHex, linkMacString(o.installId, o.route, ts, nonce.toLowerCase(), sha256Hex(o.body)));
  if (!safeEqual(expected, sig.toLowerCase())) return { ok: false, status: 401, error: "bad link signature" };
  return { ok: true, ts, nonce: nonce.toLowerCase() };
}

/** Pure checks, then the nonce claim (atomic SET NX in the store; false = already seen within 10 min). */
export async function verifyLinkRequest(o: Parameters<typeof checkLinkRequest>[0] & { claimNonce: (nonce: string) => Promise<boolean> }): Promise<LinkVerdict> {
  const v = checkLinkRequest(o);
  if (!v.ok) return v;
  if (!(await o.claimNonce(v.nonce))) return { ok: false, status: 409, error: "nonce already used" };
  return v;
}
