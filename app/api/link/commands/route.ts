import { parseJsonBytes } from "@/lib/continuous/http";
import { isResponse, linkEntry } from "@/lib/continuous/linkRoute";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/link/commands — body `{}`; answers the pending, unexpired commands, oldest first, at most 5. */
export async function POST(req: Request) {
  const entry = await linkEntry(req, "commands");
  if (isResponse(entry)) return entry;
  const parsed = parseJsonBytes(entry.body);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return fail(400, "body must be a JSON object");
  try { return json({ commands: await entry.ctx.store.pending(entry.nowSec) }); } catch (err) { return failFrom(err); }
}
