import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Node-only primitives shared by the link MAC, the command MAC and the login path. Keys are the DECODED bytes of the
 *  64-hex strings in link.json / the environment (bytes.fromhex on the Mac side). */
export const HEX16 = /^[a-f0-9]{16}$/i;
export const HEX32 = /^[a-f0-9]{32}$/i;
export const HEX64 = /^[a-f0-9]{64}$/i;

export function keyBytes(hex: string): Buffer {
  if (typeof hex !== "string" || !HEX64.test(hex)) throw new Error("key must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function hmacHex(keyHex: string, message: string): string {
  return createHmac("sha256", keyBytes(keyHex)).update(message, "utf8").digest("hex");
}

export function sha256Hex(data: Uint8Array | string): string {
  const h = createHash("sha256");
  if (typeof data === "string") h.update(data, "utf8"); else h.update(data);
  return h.digest("hex");
}

/** Constant-time equality for same-length strings (hex digests, tokens). Different lengths are simply unequal. */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}
