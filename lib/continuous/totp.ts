import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP for the hosted login's second factor: HMAC-SHA1, 30 s step, 6 digits, ±1 step. TOTP_SECRET is
 * RFC 4648 base32 (160 bits from `supervisor.py dashboard-passcode`; padding optional, case-insensitive).
 * Replay inside a step is refused by the caller through the durable store (LinkStore.claimTotpStep).
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;

export function base32Decode(s: unknown): Buffer | null {
  if (typeof s !== "string") return null;
  const clean = s.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0 || clean.length > 128 || !/^[A-Z2-7]+$/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Uint8Array): string {
  let out = "", bits = 0, value = 0;
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function randomTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpCounter(nowSec: number, step = TOTP_STEP_SEC): number {
  return Math.floor(nowSec / step);
}

export function totpCode(secretB32: string, nowSec: number): string {
  const secret = base32Decode(secretB32);
  if (!secret) throw new Error("TOTP_SECRET is not valid base32");
  return hotp(secret, totpCounter(nowSec));
}

/**
 * The step counter whose code matched (so the caller can refuse a replay of that step), or null. Every candidate in the
 * window is evaluated and compared in constant time; there is no early exit on a match.
 */
export function verifyTotp(secretB32: unknown, code: unknown, nowSec: number, window = 1): number | null {
  const secret = base32Decode(secretB32);
  if (!secret || secret.length < 10 || typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const c = totpCounter(nowSec);
  const given = Buffer.from(code, "utf8");
  let found: number | null = null;
  for (let d = -window; d <= window; d++) {
    const cand = Buffer.from(hotp(secret, c + d), "utf8");
    if (timingSafeEqual(cand, given)) found = c + d;
  }
  return found;
}
