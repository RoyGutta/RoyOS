import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * DASHBOARD_PASS_HASH = `scrypt$N$r$p$salt_hex$hash_hex` (contract: N=2^15, r=8, p=1, 32-byte key), produced by
 * `supervisor.py dashboard-passcode`. Verification is async (scrypt off the event loop), compares in constant time, and
 * sizes `maxmem` from the parsed parameters: Node refuses when 128·r·(N+2) + 128·r·p exceeds maxmem, so a bare
 * "32 MiB default" fails for N=2^15, r=8 (33 554 432 + 1 024 bytes). Parameter bounds keep a hostile hash from asking for
 * gigabytes.
 */
export interface PassHash { N: number; r: number; p: number; salt: Buffer; hash: Buffer }

const FORMAT = /^scrypt\$(\d{1,8})\$(\d{1,3})\$(\d{1,3})\$([a-f0-9]{16,128})\$([a-f0-9]{64})$/i;
const N_MIN = 1 << 12, N_MAX = 1 << 17, R_MAX = 16, P_MAX = 4;

export function parsePassHash(s: unknown): PassHash | null {
  if (typeof s !== "string") return null;
  const m = FORMAT.exec(s);
  if (!m) return null;
  const N = Number(m[1]), r = Number(m[2]), p = Number(m[3]);
  if (N < N_MIN || N > N_MAX || (N & (N - 1)) !== 0 || r < 1 || r > R_MAX || p < 1 || p > P_MAX) return null;
  return { N, r, p, salt: Buffer.from(m[4], "hex"), hash: Buffer.from(m[5], "hex") };
}

/** Exact scrypt working set plus 1 MiB slack: 128·r·(N+2) for V, 128·r·p for B. */
export function scryptMaxMem(N: number, r: number, p: number): number {
  return 128 * r * (N + 2) + 128 * r * p + (1 << 20);
}

export function verifyPasscode(hashStr: unknown, passcode: unknown): Promise<boolean> {
  const h = parsePassHash(hashStr);
  if (!h || typeof passcode !== "string" || passcode.length === 0 || passcode.length > 1024) return Promise.resolve(false);
  return new Promise((resolve) => {
    scrypt(Buffer.from(passcode, "utf8"), h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: scryptMaxMem(h.N, h.r, h.p) }, (err, key) => {
      resolve(!err && key.length === h.hash.length && timingSafeEqual(key, h.hash));
    });
  });
}

/** Test/staging helper in the Mac's format. Production hashes come from `supervisor.py dashboard-passcode`. */
export function makePassHash(passcode: string, o: { N?: number; r?: number; p?: number } = {}): Promise<string> {
  const N = o.N ?? 1 << 15, r = o.r ?? 8, p = o.p ?? 1;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(passcode, "utf8"), salt, 32, { N, r, p, maxmem: scryptMaxMem(N, r, p) }, (err, key) => {
      if (err) reject(err); else resolve(`scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`);
    });
  });
}
