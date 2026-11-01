import { hostedStatus } from "@/lib/continuous/adapters/hosted";
import { authContext, sessionFromCookieHeader, type AuthContext } from "@/lib/continuous/auth";
import { fail, failFrom, json } from "@/lib/continuous/respond";
import { onlineFrom } from "@/lib/continuous/snapshot";
import type { StatusPayload } from "@/lib/continuous/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/continuous/status — session required. Local: `supervisor.py link-status` now. Hosted: the Mac's last report. */
export async function GET(req: Request) {
  let ctx: AuthContext;
  try { ctx = authContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  let session;
  try { session = await sessionFromCookieHeader(req.headers.get("cookie"), ctx); } catch (err) { return failFrom(err); }
  if (!session) return fail(401, "sign in required");
  const nowMs = Date.now();
  try {
    let payload: StatusPayload;
    if (ctx.hosted) {
      const h = await hostedStatus(ctx.store);
      const { online, ageSec } = onlineFrom(h.receivedAt, nowMs);
      payload = { mode: "hosted", online, ageSec, receivedAt: h.receivedAt, snapshot: h.snapshot, pending: h.pending, recent: h.recent, installed: true, error: null, csrf: session.csrf, serverTime: new Date(nowMs).toISOString() };
    } else {
      const { localStatus } = await import("@/lib/continuous/adapters/local");
      const [l, recent] = await Promise.all([localStatus(), ctx.store.recent()]);
      const { online, ageSec } = onlineFrom(l.receivedAt, Date.now());
      payload = { mode: "local", online: online && l.snapshot !== null, ageSec, receivedAt: l.receivedAt, snapshot: l.snapshot, pending: [], recent, installed: l.installed, error: l.error, csrf: session.csrf, serverTime: new Date(nowMs).toISOString() };
    }
    return json(payload);
  } catch (err) { return failFrom(err); }
}
