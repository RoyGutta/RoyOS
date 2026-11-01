import { parseJsonBytes } from "@/lib/continuous/http";
import { parseCommandsBody } from "@/lib/continuous/linkBodies";
import { isResponse, linkEntry } from "@/lib/continuous/linkRoute";
import { fail, failFrom, json } from "@/lib/continuous/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/link/commands — body exactly `{}` (any key is refused); answers the pending, unexpired commands, oldest first, at most 5. */
export async function POST(req: Request) {
  const entry = await linkEntry(req, "commands");
  if (isResponse(entry)) return entry;
  const parsed = parseJsonBytes(entry.body);
  if (!parsed.ok) return fail(400, "body must be JSON");
  const b = parseCommandsBody(parsed.value);
  if (!b.ok) return fail(400, b.error);
  try { return json({ commands: await entry.ctx.store.pending(entry.nowSec) }); } catch (err) { return failFrom(err); }
}
