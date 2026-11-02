import { NextResponse } from "next/server";
import { requireApprovalSession } from "@/lib/jarvis/approvalSession";
import { parseCliJson, runCli } from "@/lib/jarvis/cli";
import { localWriteGuard, rateLimiter } from "@/lib/jarvis/guard";
import { AT_WITH_OFFSET, CONTENT_VERSION, NONCE, firstClick, oneClick, secondClick } from "@/lib/jarvis/twoClick";

export const dynamic = "force-dynamic";

/**
 * POST /api/content/action — the dashboard's ONE write path into the Content OS.
 * It shells out to content_os.py so the file lock, prerequisites and audit log are
 * the same code Jarvis and the worker use. Explicit human actions only:
 *   {action:"approve-first", id, version} → {ok, nonce, publishAt}  click 1 of 2 (signs first:content:<id>:<version>:…)
 *   {action:"approve", id, version, nonce, at, note?}              click 2 of 2 (--stage second; signs content:<id>:<version>|at=<at>:…)
 *   {action:"reject", id, note} | {action:"pause", on:boolean} | {action:"queue", id, at} | {action:"rights", id, state, note}
 *   | {action:"launch-flag", key, on:boolean, note?}
 * Recording rights (other than NOT_ALLOWED), resuming the publisher and setting a launch flag are Roy's attestations: one
 * signed click on stdin (Sidebar RC4-1; content_os.py refuses them otherwise). Blocking directions sign nothing.
 * `version` is the reviewVersion the card DISPLAYED (G9-5): the browser sends it with both clicks, the signature binds it,
 * and content_os.py refuses it when the item changed since. `at` is the publish time click 2 confirms, with its UTC offset
 * (the time Roy picked, or click 1's proposal); it is signed too (G9v2-1), so the store cannot move it.
 * The two approve actions need Roy's session + X-CSRF (G9-2).
 */
const ID = /^cnt_[a-f0-9]{6,16}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;
const APPROVALS = new Set(["approve-first", "approve"]);
/** Sidebar G9-2 LOW: actions that let something publish (resume the publisher, record rights, move a queued time) need
 *  Roy's session too; stopping things (pause on, reject/pull) stays one click away. */
const ENABLING = (b: { action?: string; on?: boolean }) => b.action === "rights" || b.action === "queue" || b.action === "launch-flag" || (b.action === "pause" && b.on === false);
const LAUNCH_FLAGS = new Set(["auditSubmitted", "auditPassed", "thumbnailsVerified", "syntheticMediaVerified", "oauthProduction"]);
const limited = rateLimiter(30, 60_000);

export async function POST(req: Request) {
  const refused = localWriteGuard(req) ?? limited();
  if (refused) return refused;
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; at?: string; note?: string; on?: boolean; state?: string; version?: unknown; nonce?: unknown; key?: unknown };
  if (APPROVALS.has(String(b.action)) || ENABLING(b)) {
    const gate = await requireApprovalSession(req);     // G9-2: session + X-CSRF + origin, before anything is signed or enabled
    if (!gate.ok) return gate.res;
  }
  const by = "dashboard";
  let args: string[] | null = null;
  let stdin: string | null = null;
  let nonce: string | null = null;
  if ((b.action === "approve" || b.action === "approve-first") && b.id && ID.test(b.id)) {
    if (typeof b.version !== "string" || !CONTENT_VERSION.test(b.version)) return NextResponse.json({ ok: false, error: "version must be the 64-hex reviewVersion shown on the approval card; nothing signed" }, { status: 400 });
    const scope = `content:${b.id}:${b.version}`;
    // Roy's TWO tier: publishing is two separate clicks, 2 s – 5 min apart; both signatures go on stdin, never argv.
    if (b.action === "approve-first") {
      const c = firstClick(scope);
      nonce = c.nonce; stdin = c.stdin;
      args = ["approve", b.id, "--stage", "first", "--version", b.version, "--by", by, "--auth-stdin"];
    } else {
      if (typeof b.nonce !== "string" || !NONCE.test(b.nonce)) return NextResponse.json({ ok: false, error: "click 1 first: the confirmation needs the nonce returned by \"Approve (1 of 2)\"" }, { status: 400 });
      if (typeof b.at !== "string" || !AT_WITH_OFFSET.test(b.at)) return NextResponse.json({ ok: false, error: "click 2 needs the publish time shown with it, with its UTC offset; nothing signed" }, { status: 400 });
      stdin = secondClick(scope, b.nonce, Date.now(), `|at=${b.at}`).stdin;
      args = ["approve", b.id, "--stage", "second", "--version", b.version, "--by", by, "--auth-stdin", "--at", b.at];
      if (b.note) args.push("--note", b.note.slice(0, 300));
    }
  } else if (b.action === "reject" && b.id && ID.test(b.id) && b.note) {
    args = ["reject", b.id, "--by", by, "--note", b.note.slice(0, 300)];
  } else if (b.action === "pause" && typeof b.on === "boolean") {
    args = ["pause", b.on ? "on" : "off", "--by", by];
    if (!b.on) { stdin = oneClick("pause:off").stdin; args.push("--auth-stdin"); }
  } else if (b.action === "rights" && b.id && ID.test(b.id) && b.state && /^[A-Z_]{5,16}$/.test(b.state)) {
    args = ["rights", b.id, b.state, "--by", by, "--note", (b.note ?? "").slice(0, 300)];
    if (b.state !== "NOT_ALLOWED") { stdin = oneClick(`rights:${b.id}:${b.state}`).stdin; args.push("--auth-stdin"); }
  } else if (b.action === "launch-flag" && typeof b.key === "string" && LAUNCH_FLAGS.has(b.key) && typeof b.on === "boolean") {
    args = ["launch-flag", b.key, b.on ? "on" : "off", "--by", by, "--note", (b.note ?? "").slice(0, 300)];
    if (b.on) { stdin = oneClick(`launch:${b.key}:on`).stdin; args.push("--auth-stdin"); }
  } else if (b.action === "queue" && b.id && ID.test(b.id) && b.at && ISO.test(b.at)) {
    args = ["queue", b.id, b.at, "--by", by];
  }
  if (!args) return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
  const parsed = parseCliJson(await runCli("content_os.py", args, stdin, { timeoutMs: 60_000 }), "content_os.py");
  if (parsed.ok === true && nonce) parsed.nonce = nonce;          // click 1 succeeded: the browser keeps this for click 2
  return NextResponse.json(parsed, { status: parsed.ok ? 200 : 409 });
}
