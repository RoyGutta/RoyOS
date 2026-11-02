import { NextResponse } from "next/server";

/**
 * Local-only write guard for the dashboard's POST routes. The dashboard is a
 * single-user tool bound to localhost, but a hostile web page Roy visits could
 * still fire a cross-site POST at it (or use DNS rebinding). Every write route
 * therefore requires: a loopback Host, an Origin that is absent or loopback,
 * and a JSON content type. Reads are unaffected.
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Host + Origin + Sec-Fetch-Site checks only (any content type). Use for multipart uploads. */
export function localOriginGuard(req: Request): NextResponse | null {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return NextResponse.json({ ok: false, error: "writes are accepted only on localhost" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) {
    let oh = "";
    try { oh = new URL(origin).host; } catch { oh = ""; }
    if (!LOOPBACK.test(oh)) return NextResponse.json({ ok: false, error: "cross-origin writes are refused" }, { status: 403 });
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return NextResponse.json({ ok: false, error: "cross-site writes are refused" }, { status: 403 });
  return null;
}

/**
 * Approval-grade origin guard: a request that will SIGN an approval must look like a fetch from the dashboard page itself
 * in a browser — Origin present (not "null"), its host:port identical to this request's Host, and Sec-Fetch-Site exactly
 * "same-origin" (a page on another local port is only "same-site"). This stops BROWSERS: a page on another origin cannot
 * set those headers. It does not stop a local script — curl -H, a Node script or any unsandboxed process CAN forge Origin
 * and Sec-Fetch-Site (Sidebar G9-2). What binds a click to Roy is the Continuous Mode session plus the session-bound
 * X-CSRF header (lib/jarvis/approvalSession.ts requireApprovalSession), which every signing route requires on top of
 * this guard; the runtime additionally refuses an unsigned yes.
 */
export function approvalOriginGuard(req: Request): NextResponse | null {
  const refused = localOriginGuard(req);
  if (refused) return refused;
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return NextResponse.json({ ok: false, error: "approvals are accepted only from the dashboard page itself" }, { status: 403 });
  let oh = "";
  try { oh = new URL(origin).host.toLowerCase(); } catch { oh = ""; }
  if (!oh || oh !== host) return NextResponse.json({ ok: false, error: "approval origin does not match this dashboard's host and port" }, { status: 403 });
  if (req.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json({ ok: false, error: "approvals must be same-origin fetches from the dashboard page" }, { status: 403 });
  // Next's own server stamps x-forwarded-host with the real Host; a proxy or a client that names another host is refused.
  const fwd = (req.headers.get("x-forwarded-host") ?? "").toLowerCase();
  if ((fwd && fwd !== host) || req.headers.get("forwarded")) return NextResponse.json({ ok: false, error: "forwarded requests cannot approve" }, { status: 403 });
  return null;
}

export function localWriteGuard(req: Request): NextResponse | null {
  const refused = localOriginGuard(req);
  if (refused) return refused;
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return NextResponse.json({ ok: false, error: "content-type must be application/json" }, { status: 415 });
  return null;
}

/** One subprocess at a time per route: a second request while one runs gets 409. */
export function inflightLock() {
  let busy = false;
  return {
    acquire(): boolean { if (busy) return false; busy = true; return true; },
    release() { busy = false; },
  };
}

/** A small per-route token bucket: `limit` requests per `windowMs`. Local pages cannot queue
 *  unbounded turns, tasks or uploads; a 429 names the window. */
export function rateLimiter(limit: number, windowMs: number) {
  let stamps: number[] = [];
  return (): NextResponse | null => {
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < windowMs);
    if (stamps.length >= limit) return NextResponse.json({ ok: false, error: `rate limit: ${limit} requests per ${Math.round(windowMs / 1000)} s` }, { status: 429 });
    stamps.push(now);
    return null;
  };
}
