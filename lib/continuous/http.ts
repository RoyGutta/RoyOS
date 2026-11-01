import { safeEqual } from "./crypto";
import { isHosted, isLoopbackHost } from "./mode";

/** Request-level checks for the browser routes, as plain values so they are unit-testable without Next. */
export type Refusal = { status: number; error: string } | null;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** The eight hextets of an IPv6 address (with `::` and an embedded dotted quad), or null when it is not one. */
function parseIpv6(s: string): number[] | null {
  if (s.length < 2 || s.length > 45 || !/^[0-9a-f:.]+$/.test(s)) return null;
  let text = s;
  const quad = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (quad) {
    const q = quad.slice(2, 6).map(Number);
    if (q.some((n) => n > 255)) return null;
    text = `${quad[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const hextets = (part: string) => (part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = hextets(halves[0]), tail = halves.length === 2 ? hextets(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

/**
 * The bucket an address falls into: IPv4 as itself; IPv6 by its /64 (one person holds at least a /64, so one person
 * cannot mint fresh buckets per address); an IPv4-mapped IPv6 address as its IPv4. Anything else is one shared bucket.
 */
export function clientBucket(ipRaw: string | null | undefined): string {
  const ip = (ipRaw ?? "").trim().toLowerCase();
  if (IPV4.test(ip)) return ip;
  const h = parseIpv6(ip);
  if (!h) return "shared";
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/**
 * Rate-limit / lockout identity. Hosted ON VERCEL (`VERCEL=1`): the platform-verified client IP, `x-real-ip`, which
 * Vercel overwrites on every request. Hosted anywhere else nobody overwrites that header, so a client could pick its
 * own bucket and escape its lockout: every client then shares ONE bucket (DC-8). The left-most X-Forwarded-For entry
 * is never consulted. Local: everything is Roy on loopback, one bucket.
 */
export function clientId(headers: Headers, hosted: boolean, onVercel = process.env.VERCEL === "1"): string {
  if (!hosted) return "local";
  if (!onVercel) return "shared";
  return clientBucket(headers.get("x-real-ip"));
}

/**
 * Approval-grade same-origin guard (the pattern of lib/jarvis/guard.ts, made host-agnostic for hosted mode): a write
 * must come from the dashboard page itself in a browser. Origin present and not "null" and EXACTLY this request's
 * scheme://host:port (https when hosted on a public host, http on loopback and in local mode — DC-9), Sec-Fetch-Site
 * exactly "same-origin", and no Forwarded / foreign X-Forwarded-Host.
 */
export function sameOriginGuard(headers: Headers, hosted = isHosted()): Refusal {
  const host = (headers.get("host") ?? "").trim().toLowerCase();
  if (!host) return { status: 403, error: "missing Host" };
  const origin = headers.get("origin");
  if (!origin || origin === "null") return { status: 403, error: "writes are accepted only from the dashboard page itself" };
  const scheme = hosted && !isLoopbackHost(host) ? "https" : "http";
  if (origin.trim().toLowerCase() !== `${scheme}://${host}`) return { status: 403, error: "origin does not match this dashboard's scheme, host and port" };
  if (headers.get("sec-fetch-site") !== "same-origin") return { status: 403, error: "writes must be same-origin fetches from the dashboard page" };
  const fwd = (headers.get("x-forwarded-host") ?? "").trim().toLowerCase();
  if ((fwd && fwd !== host) || headers.get("forwarded")) return { status: 403, error: "forwarded requests cannot write" };
  const ct = (headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) return { status: 415, error: "content-type must be application/json" };
  return null;
}

/** X-CSRF must equal the session's CSRF value, compared in constant time. */
export function csrfOk(headers: Headers, expected: string): boolean {
  const given = headers.get("x-csrf");
  return typeof given === "string" && given.length === expected.length && safeEqual(given, expected);
}

/** Read a body with a hard byte cap, streaming so a lying Content-Length cannot make the server buffer more. */
export async function readBodyCapped(req: Request, cap: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number; error: string }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) return { ok: false, status: 413, error: `body exceeds ${cap} bytes` };
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel().catch(() => undefined); return { ok: false, status: 413, error: `body exceeds ${cap} bytes` }; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return { ok: true, bytes: out };
}

export function parseJsonBytes(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }; } catch { return { ok: false }; }
}
