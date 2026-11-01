import { parseJsonBytes } from "@/lib/continuous/http";
import { isResponse, linkEntry } from "@/lib/continuous/linkRoute";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** POST /api/link/ack — `{id, ok, message}` (message ≤ 120 chars, plain text). Marks the command done; kept 24 h. */
export async function POST(req: Request) {
  const entry = await linkEntry(req, "ack");
  if (isResponse(entry)) return entry;
  const parsed = parseJsonBytes(entry.body);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return fail(400, "body must be a JSON object");
  const b = parsed.value as Record<string, unknown>;
  if (typeof b.id !== "string" || !UUID_V4.test(b.id)) return fail(400, "id must be a uuid v4");
  if (typeof b.ok !== "boolean") return fail(400, "ok must be a boolean");
  if (b.message !== undefined && b.message !== null && (typeof b.message !== "string" || b.message.length > 120)) return fail(400, "message must be ≤ 120 characters");
  try {
    const outcome = await entry.ctx.store.ack(b.id, b.ok, b.message ?? null, new Date().toISOString());
    if (outcome === "unknown") return fail(404, "unknown command id");
    return json({ ok: true, result: outcome });
  } catch (err) { return failFrom(err); }
}
