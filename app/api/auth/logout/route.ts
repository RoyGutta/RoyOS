import { authContext, logout, type AuthContext } from "@/lib/continuous/auth";
import { sameOriginGuard } from "@/lib/continuous/http";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — deletes the session record and clears the cookie. Same-origin only. */
export async function POST(req: Request) {
  const refused = sameOriginGuard(req.headers);
  if (refused) return fail(refused.status, refused.error);
  let ctx: AuthContext;
  try { ctx = authContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  try { return json({ ok: true }, 200, { "set-cookie": await logout(req.headers.get("cookie"), ctx) }); } catch (err) { return failFrom(err); }
}
