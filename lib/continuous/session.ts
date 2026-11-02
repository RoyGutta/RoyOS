/**
 * Session cookie primitives, edge-safe (WebCrypto only) so middleware.ts and the Node handlers verify the same way.
 *
 * Cookie value: `<sid>.<base64url HMAC-SHA256(SESSION_KEY, "sess\nv1\n" + sid)>`. The sid is 32 hex of randomness; the
 * HMAC keeps forged sids from ever reaching the store. The session RECORD (csrf, iat, exp) lives in the durable store
 * under `session:<sid>` with a 12 h TTL, so logout and rotation really revoke (lib/continuous/linkStore.ts).
 *
 * Attributes: HttpOnly; SameSite=Strict; Path=/; Max-Age ≤ 12 h; Secure and the `__Host-` prefix when hosted.
 */
export const SESSION_MAX_SEC = 12 * 3600;
const SID = /^[a-f0-9]{32}$/;
const KEY = /^[a-f0-9]{64}$/i;
const enc = new TextEncoder();

export function sessionCookieName(hosted: boolean): string {
  return hosted ? "__Host-jarvis_session" : "jarvis_session";
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return null;   // exactly 32 bytes
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return b64url(out) === s ? out : null;   // canonical only: the last character's 2 spare bits must be zero (one spelling per cookie)
  } catch { return null; }
}

async function hmacKey(keyHex: string): Promise<CryptoKey> {
  if (!KEY.test(keyHex)) throw new Error("SESSION_KEY must be 64 hex characters");
  return crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSessionId(sid: string, keyHex: string): Promise<string> {
  if (!SID.test(sid)) throw new Error("session id must be 32 hex characters");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(keyHex), enc.encode("sess\nv1\n" + sid)));
  return `${sid}.${b64url(sig)}`;
}

/** The sid when the cookie's HMAC verifies (constant-time inside WebCrypto), else null. Store lookup is the caller's. */
export async function verifySessionCookie(value: string | null | undefined, keyHex: string): Promise<string | null> {
  if (!value || value.length > 100) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const sid = value.slice(0, dot);
  const sig = unb64url(value.slice(dot + 1));
  if (!SID.test(sid) || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(keyHex), sig, enc.encode("sess\nv1\n" + sid)); } catch { ok = false; }
  return ok ? sid : null;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function serializeSessionCookie(name: string, value: string, o: { hosted: boolean; maxAgeSec: number }): string {
  const maxAge = Math.max(0, Math.min(SESSION_MAX_SEC, Math.floor(o.maxAgeSec)));
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (o.hosted) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(name: string, hosted: boolean): string {
  return serializeSessionCookie(name, "", { hosted, maxAgeSec: 0 });
}
