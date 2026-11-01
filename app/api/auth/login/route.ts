import { authContext, login, type AuthContext } from "@/lib/continuous/auth";
import { clientId, parseJsonBytes, readBodyCapped, sameOriginGuard } from "@/lib/continuous/http";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/login {passphrase, code?} — same-origin only; lockouts and the TOTP step claim live in the durable store. */
export async function POST(req: Request) {
  const refused = sameOriginGuard(req.headers);
  if (refused) return fail(refused.status, refused.error);
  let ctx: AuthContext;
  try { ctx = authContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  const body = await readBodyCapped(req, 4096);
  if (!body.ok) return fail(body.status, body.error);
  const parsed = parseJsonBytes(body.bytes);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return fail(400, "body must be a JSON object");
  const b = parsed.value as Record<string, unknown>;
  try {
    const r = await login(ctx, { passphrase: b.passphrase, code: typeof b.code === "string" ? b.code.replace(/\s+/g, "") : b.code, client: clientId(req.headers, ctx.hosted), nowSec: Math.floor(Date.now() / 1000) });
    if (!r.ok) return fail(r.status, r.error, r.retryAfterSec ? { "retry-after": String(r.retryAfterSec) } : undefined);
    return json({ ok: true }, 200, { "set-cookie": r.setCookie });
  } catch (err) { return failFrom(err); }
}
