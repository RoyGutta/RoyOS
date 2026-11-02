import type { NextResponse } from "next/server";
import { authContext, sessionFromCookieHeader, type AuthContext } from "@/lib/continuous/auth";
import { csrfOk } from "@/lib/continuous/http";
import { fail, failFrom } from "@/lib/continuous/respond";
import { approvalOriginGuard } from "./guard";

/**
 * G9-2: a request that SIGNS an approval must be Roy's own click, not any local HTTP client. Three checks, all required,
 * before anything is signed or run:
 *   1. the approval-grade origin guard (lib/jarvis/guard.ts) — stops browser pages on other origins; a script can forge it;
 *   2. a valid Continuous Mode login session — the cookie's HMAC verifies and its record is live in the durable store
 *      (local mode: the passphrase session from link.json, lib/continuous/auth.ts);
 *   3. the session-bound X-CSRF header, compared in constant time.
 * The session is what binds a click to Roy: only a browser that holds his HttpOnly cookie AND read the CSRF value from a
 * same-origin response can send both. 401 without a session, 403 without the right X-CSRF or origin, 503 when the keys
 * or the store are unavailable.
 */
export type ApprovalGate = { ok: true; csrf: string } | { ok: false; res: NextResponse };
export type ContextFactory = (host: string | null) => AuthContext;

let factory: ContextFactory = authContext;
/** Tests only: an AuthContext over test keys and a temp store (never link.json). */
export function setAuthContextForTests(f: ContextFactory | null) { factory = f ?? authContext; }
export function approvalAuthContext(host: string | null): AuthContext { return factory(host); }

export async function requireApprovalSession(req: Request): Promise<ApprovalGate> {
  const refused = approvalOriginGuard(req);
  if (refused) return { ok: false, res: refused };
  let ctx: AuthContext;
  try { ctx = factory(req.headers.get("host")); } catch (err) { return { ok: false, res: failFrom(err) }; }
  let session: { csrf: string } | null;
  try { session = await sessionFromCookieHeader(req.headers.get("cookie"), ctx); } catch (err) { return { ok: false, res: failFrom(err) }; }
  if (!session) return { ok: false, res: fail(401, "sign in to approve") };
  if (!csrfOk(req.headers, session.csrf)) return { ok: false, res: fail(403, "missing or wrong X-CSRF") };
  return { ok: true, csrf: session.csrf };
}
