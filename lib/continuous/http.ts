import { safeEqual } from "./crypto";

/** Request-level checks for the browser routes, as plain values so they are unit-testable without Next. */
export type Refusal = { status: number; error: string } | null;

/**
 * Rate-limit / lockout identity. Hosted: the platform-verified client IP (`x-real-ip`, which Vercel overwrites and
 * documents as identical to its own x-forwarded-for). The left-most X-Forwarded-For entry is never consulted: a client
 * can write that header. Local: everything is Roy on loopback, one bucket.
 */
export function clientId(headers: Headers, hosted: boolean): string {
  if (!hosted) return "local";
  const ip = (headers.get("x-real-ip") ?? "").trim().toLowerCase();
  return /^[0-9a-f.:]{3,45}$/.test(ip) ? ip : "unknown";
}

/**
 * Approval-grade same-origin guard (the pattern of lib/jarvis/guard.ts, made host-agnostic for hosted mode): a write
 * must come from the dashboard page itself in a browser. Origin present and not "null", its host:port identical to
 * this request's Host, Sec-Fetch-Site exactly "same-origin", and no Forwarded / foreign X-Forwarded-Host.
 */
export function sameOriginGuard(headers: Headers): Refusal {
  const host = (headers.get("host") ?? "").trim().toLowerCase();
  if (!host) return { status: 403, error: "missing Host" };
  const origin = headers.get("origin");
  if (!origin || origin === "null") return { status: 403, error: "writes are accepted only from the dashboard page itself" };
  let oh = "";
  try { oh = new URL(origin).host.toLowerCase(); } catch { oh = ""; }
  if (!oh || oh !== host) return { status: 403, error: "origin does not match this dashboard's host and port" };
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
