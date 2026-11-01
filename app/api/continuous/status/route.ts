import { hostedStatus } from "@/lib/continuous/adapters/hosted";
import { authContext, sidFromCookieHeader, type AuthContext } from "@/lib/continuous/auth";
import { fail, failFrom, json } from "@/lib/continuous/respond";
import { onlineFrom } from "@/lib/continuous/snapshot";
import type { StatusPayload } from "@/lib/continuous/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/continuous/status — session required. Local: `supervisor.py link-status` now. Hosted: the Mac's last report.
 * Store budget (DC-5): two commands per call — hosted: MGET (session + snapshot) and LRANGE (command log); local: GET
 * session and LRANGE. The cookie's HMAC is verified before any store access.
 */
export async function GET(req: Request) {
  let ctx: AuthContext;
  try { ctx = authContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  const sid = await sidFromCookieHeader(req.headers.get("cookie"), ctx);
  if (!sid) return fail(401, "sign in required");
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const serverTime = new Date(nowMs).toISOString();
  try {
    let payload: StatusPayload;
    if (ctx.hosted) {
      const h = await hostedStatus(ctx.store, sid, nowSec);
      if (!h) return fail(401, "sign in required");
      const { online, ageSec } = onlineFrom(h.receivedAt, nowMs);
      payload = { mode: "hosted", online, ageSec, receivedAt: h.receivedAt, snapshot: h.snapshot, pending: h.pending, recent: h.recent, installed: true, error: null, csrf: h.session.csrf, serverTime };
    } else {
      const session = await ctx.store.getSession(sid, nowSec);
      if (!session) return fail(401, "sign in required");
      const { localStatus } = await import("@/lib/continuous/adapters/local");
      const [l, log] = await Promise.all([localStatus(), ctx.store.commandLog(nowSec)]);
      const { online, ageSec } = onlineFrom(l.receivedAt, Date.now());
      payload = { mode: "local", online: online && l.snapshot !== null, ageSec, receivedAt: l.receivedAt, snapshot: l.snapshot, pending: [], recent: log.recent, installed: l.installed, error: l.error, csrf: session.csrf, serverTime };
    }
    return json(payload);
  } catch (err) { return failFrom(err); }
}
