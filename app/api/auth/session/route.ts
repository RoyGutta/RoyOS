import { sessionFromCookieHeader, type AuthContext } from "@/lib/continuous/auth";
import { fail, failFrom, json } from "@/lib/continuous/respond";
import { approvalAuthContext } from "@/lib/jarvis/approvalSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session — is this browser signed in? 200 {ok:true, csrf} for a live session (the value every approval
 * button sends as X-CSRF, the way the Continuous Mode panel does); 401 without one; 503 when the keys or the durable
 * store are unavailable. One store read, no write. The cookie is HttpOnly and SameSite=Strict and the response is
 * same-origin-only by the browser, so a foreign page can neither send the cookie nor read the value.
 */
export async function GET(req: Request) {
  let ctx: AuthContext;
  try { ctx = approvalAuthContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  try {
    const session = await sessionFromCookieHeader(req.headers.get("cookie"), ctx);
    if (!session) return fail(401, "sign in required");
    return json({ ok: true, csrf: session.csrf });
  } catch (err) { return failFrom(err); }
}
