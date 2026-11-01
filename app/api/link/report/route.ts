import { parseJsonBytes } from "@/lib/continuous/http";
import { isResponse, linkEntry } from "@/lib/continuous/linkRoute";
import { fail, failFrom, json } from "@/lib/continuous/respond";
import { validateHostedSnapshot } from "@/lib/continuous/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/link/report — the Mac's HOSTED snapshot. Re-validated field by field (LP-3) before it is stored with receivedAt. */
export async function POST(req: Request) {
  const entry = await linkEntry(req, "report");
  if (isResponse(entry)) return entry;
  const parsed = parseJsonBytes(entry.body);
  if (!parsed.ok) return fail(400, "body must be JSON");
  const v = validateHostedSnapshot(parsed.value, entry.ctx.keys.installId);
  if (!v.ok) return fail(400, `snapshot rejected: ${v.error}`);
  const receivedAt = new Date().toISOString();
  try { await entry.ctx.store.putSnapshot(v.snapshot, receivedAt); } catch (err) { return failFrom(err); }
  return json({ ok: true, receivedAt });
}
