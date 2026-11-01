import { hostedCommand } from "@/lib/continuous/adapters/hosted";
import { authContext, sessionFromCookieHeader, type AuthContext } from "@/lib/continuous/auth";
import { buildCommand, isVerb } from "@/lib/continuous/commands";
import { csrfOk, parseJsonBytes, readBodyCapped, sameOriginGuard } from "@/lib/continuous/http";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COMMAND_LIMIT = 10;
const COMMAND_WINDOW_SEC = 60;

/**
 * POST /api/continuous/command {verb} — session + approval-grade origin guard + X-CSRF; verbs on/off/pause/resume/stop;
 * 10 per minute (durable counter). The server builds and signs the command; local mode applies it through
 * `supervisor.py link-apply`, hosted mode queues it for the Mac.
 */
export async function POST(req: Request) {
  const refused = sameOriginGuard(req.headers);
  if (refused) return fail(refused.status, refused.error);
  let ctx: AuthContext;
  try { ctx = authContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  let session;
  try { session = await sessionFromCookieHeader(req.headers.get("cookie"), ctx); } catch (err) { return failFrom(err); }
  if (!session) return fail(401, "sign in required");
  if (!csrfOk(req.headers, session.csrf)) return fail(403, "missing or wrong X-CSRF");
  const body = await readBodyCapped(req, 1024);
  if (!body.ok) return fail(body.status, body.error);
  const parsed = parseJsonBytes(body.bytes);
  const verb = parsed.ok && parsed.value && typeof parsed.value === "object" ? (parsed.value as { verb?: unknown }).verb : undefined;
  if (!isVerb(verb)) return fail(400, "verb must be one of on, off, pause, resume, stop");
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const rate = await ctx.store.hit("cmd:rate", COMMAND_LIMIT, COMMAND_WINDOW_SEC);
    if (!rate.allowed) return fail(429, `rate limit: ${COMMAND_LIMIT} commands per minute`, { "retry-after": String(COMMAND_WINDOW_SEC) });
    if (ctx.hosted) return json(await hostedCommand(ctx.store, ctx.keys, verb, nowSec), 202);
    const { localApply } = await import("@/lib/continuous/adapters/local");
    const command = buildCommand({ verb, channel: "local", installId: ctx.keys.installId, cmdKeyHex: ctx.keys.cmdKey, nowSec });
    const result = await localApply(command);
    await ctx.store.recordLocalResult(command, result.ok, result.message, new Date().toISOString());
    return json({ ...result, queued: false }, result.ok ? 200 : 409);
  } catch (err) { return failFrom(err); }
}
