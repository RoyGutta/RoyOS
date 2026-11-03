import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { hmacHex } from "../lib/continuous/crypto";
import { BROWSER, approvalFixture, get, post, type ApprovalFixture } from "./approvalHelpers";

/**
 * The Jarvis inbox route and the Jarvis status route read the voice line's files: this file points them at a temp
 * directory BEFORE the modules load (JARVIS_VOICE_LINE is read once, at import), so nothing here touches ~/Developer/Jarvis.
 */
const VL = fs.mkdtempSync(path.join(os.tmpdir(), "jl-voice-line-"));
process.env.JARVIS_VOICE_LINE = VL;
const STATUS = path.join(VL, ".voice_status.json");
const INBOX = path.join(VL, ".voice_inbox.jsonl");
let ask: (req: Request) => Promise<Response>;
let status: (req: Request) => Promise<Response>;
let fx: ApprovalFixture;

const PHONE = "+15550000001";
const OUTBOUND_TEXT = `STEP 1 of 2 — check before anything is sent. App: Messages. To: Alex Kim <${PHONE}>. Exact text: «Courts at 6? Call me on +1 555 000 0002». Is this recipient list and text exactly right?`;
const card = (tool: string) => ({ id: "apr_abc123", tool, description: "Asking Roy to confirm recipients and text (step 1 of 2)", category: "send", target: PHONE, effect: "a message reaches people outside this machine", cost: "none known", reversible: false, fullText: OUTBOUND_TEXT });
const writeStatus = (pending: Record<string, unknown> | null) => fs.writeFileSync(STATUS, JSON.stringify({ state: pending ? "WAITING_FOR_APPROVAL" : "IDLE", detail: "", background_jobs: 0, pending_approval: pending, ts: Date.now() / 1000 }));
const inboxLines = () => (fs.existsSync(INBOX) ? fs.readFileSync(INBOX, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);

before(async () => {
  ({ POST: ask } = await import("../app/api/jarvis/ask/route"));
  ({ GET: status } = await import("../app/api/jarvis/route"));
  fx = await approvalFixture();
  writeStatus(card("mcp__jarvis__outbound_review"));
});
after(() => { fx.teardown(); fs.rmSync(VL, { recursive: true, force: true }); });

test("G9-2 Jarvis inbox: an approve or decline without Roy's session, without X-CSRF or with a forged origin is refused and nothing reaches the inbox", async () => {
  const cases: [string, Record<string, string>, number][] = [
    ["no session (forged Origin + Sec-Fetch-Site only)", BROWSER, 401],
    ["session without X-CSRF", { ...BROWSER, cookie: fx.cookie }, 403],
    ["wrong X-CSRF", { ...BROWSER, cookie: fx.cookie, "x-csrf": "c".repeat(64) }, 403],
    ["same-site origin", { ...fx.withSession, origin: "http://localhost:4318" }, 403],
    ["cross-site fetch", { ...fx.withSession, "sec-fetch-site": "cross-site" }, 403],
  ];
  for (const kind of ["approve", "decline"]) for (const [label, headers, st] of cases) {
    const res = await ask(post("/api/jarvis/ask", { kind, approvalId: "apr_abc123" }, headers));
    assert.equal(res.status, st, `${kind}: ${label}`);
  }
  assert.equal(fx.signed.length, 0, "signed nothing");
  assert.equal(fs.existsSync(INBOX), false, "nothing written to the inbox");
});

test("Jarvis inbox: with Roy's session an approve is signed apr:<id> into the inbox; a decline carries no signature; a plain ask needs no session", async () => {
  let res = await ask(post("/api/jarvis/ask", { kind: "approve", approvalId: "apr_abc123" }, fx.withSession));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, kind: "approve" });
  assert.deepEqual(fx.signed, ["apr:apr_abc123"]);
  let lines = inboxLines();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "approve"); assert.equal(lines[0].approvalId, "apr_abc123"); assert.equal(lines[0].source, "dashboard");
  assert.equal(lines[0].auth, hmacHex(fx.key, "apr:apr_abc123"));

  res = await ask(post("/api/jarvis/ask", { kind: "decline", approvalId: "apr_abc123" }, fx.withSession));
  assert.equal(res.status, 200);
  lines = inboxLines();
  assert.equal(lines.length, 2); assert.equal(lines[1].kind, "decline"); assert.equal("auth" in lines[1], false);
  assert.equal(fx.signed.length, 1, "a decline signs nothing");

  res = await ask(post("/api/jarvis/ask", { text: "what should I work on?" }, BROWSER));
  assert.equal(res.status, 200);
  lines = inboxLines();
  assert.equal(lines.length, 3); assert.equal(lines[2].kind, "ask"); assert.equal("auth" in lines[2], false);
});

test("OB-10: GET /api/jarvis shows the outbound review card's fullText unmasked (full recipient and exact text) and masks every other field", async () => {
  for (const tool of ["mcp__jarvis__outbound_review", "outbound_review", "mcp__jarvis__outbound_send"]) {
    writeStatus(card(tool));
    const j = (await (await status(get("/api/jarvis", fx.withSession))).json()) as { pendingApproval: Record<string, unknown> | null };
    const p = j.pendingApproval!;
    assert.equal(p.fullText, OUTBOUND_TEXT, `${tool}: fullText verbatim`);
    assert.ok(String(p.fullText).includes(PHONE) && String(p.fullText).includes("+1 555 000 0002"), `${tool}: numbers visible`);
    assert.equal(p.target, "[redacted-phone]", `${tool}: the target field stays masked`);
    assert.equal(p.description, "Asking Roy to confirm recipients and text (step 1 of 2)");
    assert.equal(p.id, "apr_abc123");
  }
});

test("OB-10 (Sidebar LOW): without Roy's session the outbound card is masked too — no cookie or a forged cookie", async () => {
  writeStatus(card("mcp__jarvis__outbound_review"));
  for (const [label, req] of [["no cookie", get("/api/jarvis", BROWSER)], ["forged cookie", get("/api/jarvis", { ...BROWSER, cookie: fx.forgedCookie })]] as const) {
    const p = ((await (await status(req)).json()) as { pendingApproval: Record<string, unknown> }).pendingApproval;
    assert.ok(!String(p.fullText).includes(PHONE) && String(p.fullText).includes("[redacted-phone]"), `${label}: masked`);
  }
  writeStatus(null);
});

test("OB-10: the exception covers only that card — any other tool's fullText is masked, and hosted mode masks the outbound card too", async () => {
  for (const tool of ["mcp__jarvis__telephony_execute", "Bash", "mcp__jarvis__outbound_prepare", "outbound_review_extra", ""]) {
    writeStatus(card(tool));
    const p = ((await (await status(get("/api/jarvis", fx.withSession))).json()) as { pendingApproval: Record<string, unknown> }).pendingApproval;
    assert.ok(!String(p.fullText).includes(PHONE) && String(p.fullText).includes("[redacted-phone]"), `${tool || "(no tool)"}: masked`);
    assert.equal(p.target, "[redacted-phone]");
  }
  process.env.JARVIS_HOSTED = "1";
  try {
    writeStatus(card("mcp__jarvis__outbound_review"));
    const p = ((await (await status(get("/api/jarvis", fx.withSession))).json()) as { pendingApproval: Record<string, unknown> }).pendingApproval;
    assert.ok(!String(p.fullText).includes(PHONE) && String(p.fullText).includes("[redacted-phone]"), "hosted: masked");
  } finally { delete process.env.JARVIS_HOSTED; }
  writeStatus(null);
  assert.equal(((await (await status(get("/api/jarvis", fx.withSession))).json()) as { pendingApproval: unknown }).pendingApproval, null);
});

test("R13-1: the Jarvis folders are pinned — an .env value elsewhere is refused outside the test runner, and children get no JARVIS_* settings", async () => {
  const { pinnedPath, childEnv } = await import("../lib/jarvis/runs");
  const pin = path.join(os.homedir(), "Developer/Jarvis");
  const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  assert.equal(pinnedPath("JARVIS_DIR", pin, E({}), false), pin);
  assert.equal(pinnedPath("JARVIS_DIR", pin, E({ JARVIS_DIR: pin + "/" }), false), pin);                      // the same folder, spelled differently
  assert.throws(() => pinnedPath("JARVIS_DIR", pin, E({ JARVIS_DIR: "/tmp/planted" }), false), /refusing/);
  assert.throws(() => pinnedPath("JARVIS_VOICE_LINE", path.join(pin, "voice-line"), E({ JARVIS_VOICE_LINE: path.join(pin, "projects/x") }), false), /refusing/);
  assert.equal(pinnedPath("JARVIS_DIR", pin, E({ JARVIS_DIR: "/tmp/scratch" }), true), "/tmp/scratch");     // the test runner only
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { JARVIS_SECRETS_DIR: "/tmp/x", JARVIS_ROUTINES_CONFIG: "/tmp/r.json", JARVIS_AUDIT_FILE: "/tmp/a", UV_CACHE_DIR: "/tmp/u", VIRTUAL_ENV: "/tmp/v", KOKORO_VOICE: "x" });
    const env = childEnv();
    for (const k of ["JARVIS_SECRETS_DIR", "JARVIS_ROUTINES_CONFIG", "JARVIS_AUDIT_FILE", "UV_CACHE_DIR", "VIRTUAL_ENV", "KOKORO_VOICE"]) assert.equal(env[k], undefined, k);
    assert.equal(env.JARVIS_NOT_FOREGROUND, "1");
    assert.ok(env.PATH?.startsWith(`${process.env.HOME}/.local/bin:`));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});

test("R14-1: dev, build and start refuse while a mode .env file, a code-loading NODE_OPTIONS, .npmrc node-options, instrumentation or pages/ exists", async () => {
  const { hookGuard: guard } = await import("../next.config.mjs");
  const hookGuard = (r: string, o: Record<string, string>) => guard(r, o as unknown as NodeJS.ProcessEnv);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r14-"));
  try {
    assert.deepEqual(hookGuard(root, {}), []);
    fs.writeFileSync(path.join(root, ".env"), "X=1\n"); fs.writeFileSync(path.join(root, ".env.local"), "X=1\n");
    fs.writeFileSync(path.join(root, ".env.example"), "X=\n");
    assert.deepEqual(hookGuard(root, { NODE_OPTIONS: "--max-old-space-size=4096" }), []);              // allowed
    for (const f of [".env.development", ".env.development.local", ".env.production", ".env.production.local", ".env.test.local", "instrumentation.ts", ".npmrc"]) {
      fs.writeFileSync(path.join(root, f), f === ".npmrc" ? "node-options=--import=./x.mjs\n" : "NODE_OPTIONS=--import=./x.mjs\n");
      assert.equal(hookGuard(root, {}).length, 1, f);
      fs.rmSync(path.join(root, f));
    }
    fs.mkdirSync(path.join(root, "pages")); assert.equal(hookGuard(root, {}).length, 1); fs.rmSync(path.join(root, "pages"), { recursive: true });
    for (const o of ["--import=./tests/x.mjs", "--require ./x.js", "-r ./x.js", "--loader ./l.mjs", "--max-old-space-size=4096 --import ./x.mjs"])
      assert.equal(hookGuard(root, { NODE_OPTIONS: o }).length, 1, o);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
