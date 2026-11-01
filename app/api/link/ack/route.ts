import { parseJsonBytes } from "@/lib/continuous/http";
import { parseAckBody } from "@/lib/continuous/linkBodies";
import { isResponse, linkEntry } from "@/lib/continuous/linkRoute";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/link/ack — exactly `{id, ok, message?}` (message ≤ 120 chars, plain text; unknown keys refused). Marks the command done; kept 24 h. */
export async function POST(req: Request) {
  const entry = await linkEntry(req, "ack");
  if (isResponse(entry)) return entry;
  const parsed = parseJsonBytes(entry.body);
  if (!parsed.ok) return fail(400, "body must be JSON");
  const b = parseAckBody(parsed.value);
  if (!b.ok) return fail(400, b.error);
  try {
    const outcome = await entry.ctx.store.ack(b.body.id, b.body.ok, b.body.message, new Date().toISOString());
    if (outcome === "unknown") return fail(404, "unknown command id");
    return json({ ok: true, result: outcome });
  } catch (err) { return failFrom(err); }
}
