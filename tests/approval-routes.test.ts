import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { POST as agentsPost } from "../app/api/agents/action/route";
import { GET as sessionGet } from "../app/api/auth/session/route";
import { POST as contentPost } from "../app/api/content/action/route";
import { POST as factoryPost } from "../app/api/factory/route";
import { hmacHex } from "../lib/continuous/crypto";
import { setCliRunnerForTests, type CliResult, type CliScript } from "../lib/jarvis/cli";
import { BROWSER, approvalFixture, get, post, type ApprovalFixture } from "./approvalHelpers";

type Call = { script: CliScript; args: string[]; stdin: string | null };
const calls: Call[] = [];
let answer: CliResult = { code: 0, out: JSON.stringify({ ok: true, state: "AWAITING_DEPLOYMENT" }) };
let fx: ApprovalFixture;
const HASH = "deadbeefcafe0123456789ab";                 // a reviewed site hash (12–64 hex)
const VERSION = "0123456789abcdef".repeat(4);          // a displayed reviewVersion (64 hex)
const NONCE_SHAPE = /^[a-f0-9]{32}$/;
const nowSec = () => Math.floor(Date.now() / 1000);

before(async () => {
  fx = await approvalFixture();
  setCliRunnerForTests(async (script, args, stdin) => { calls.push({ script, args: [...args], stdin }); return answer; });
});
after(() => { fx.teardown(); setCliRunnerForTests(null); });
beforeEach(() => { calls.length = 0; fx.signed.length = 0; answer = { code: 0, out: JSON.stringify({ ok: true, state: "AWAITING_DEPLOYMENT" }) }; });

const nothingHappened = (label: string) => { assert.equal(fx.signed.length, 0, `${label}: signed nothing`); assert.equal(calls.length, 0, `${label}: ran nothing`); };

test("G9-2: every signing route refuses without a session, without X-CSRF, with a wrong or unbound X-CSRF, or with a forged cookie — and signs nothing", async () => {
  const attempts: [string, (h: Record<string, string>) => Promise<Response>][] = [
    ["factory approve-deploy-first", (h) => factoryPost(post("/api/factory", { action: "approve-deploy-first", project: "wf_abc123", siteHash: HASH }, h))],
    ["factory approve-deploy", (h) => factoryPost(post("/api/factory", { action: "approve-deploy", project: "wf_abc123", siteHash: HASH, nonce: "0".repeat(32) }, h))],
    ["factory approve-plan", (h) => factoryPost(post("/api/factory", { action: "approve-plan", project: "wf_abc123", planHash: "abcdef012345" }, h))],
    ["content approve-first", (h) => contentPost(post("/api/content/action", { action: "approve-first", id: "cnt_abc123", version: VERSION }, h))],
    ["content approve", (h) => contentPost(post("/api/content/action", { action: "approve", id: "cnt_abc123", version: VERSION, nonce: "0".repeat(32) }, h))],
    ["agents approve", (h) => agentsPost(post("/api/agents/action", { action: "approve", task: "task_abc123", approvalId: "apr_abc123" }, h))],
  ];
  const cases: [string, Record<string, string>, number][] = [
    ["no session, no X-CSRF (a local script with forged Origin and Sec-Fetch-Site)", BROWSER, 401],
    ["session cookie without X-CSRF", { ...BROWSER, cookie: fx.cookie }, 403],
    ["session cookie with a wrong X-CSRF", { ...BROWSER, cookie: fx.cookie, "x-csrf": "b".repeat(64) }, 403],
    ["forged cookie (signed with another key) and the real X-CSRF", { ...BROWSER, cookie: fx.forgedCookie, "x-csrf": fx.csrf }, 401],
  ];
  for (const [name, fn] of attempts) for (const [label, headers, status] of cases) {
    const res = await fn(headers);
    assert.equal(res.status, status, `${name}: ${label}`);
    assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    nothingHappened(`${name}: ${label}`);
  }
});

test("G9-2: a forged origin is refused even with Roy's session and X-CSRF (same-site port, same-site fetch, no Origin, Forwarded)", async () => {
  const { origin: _drop, ...noOrigin } = fx.withSession; void _drop;
  const cases: [string, Record<string, string>][] = [
    ["a page on another local port", { ...fx.withSession, origin: "http://127.0.0.1:4319" }],
    ["Sec-Fetch-Site same-site", { ...fx.withSession, "sec-fetch-site": "same-site" }],
    ["no Origin header", noOrigin],
    ["a Forwarded header", { ...fx.withSession, forwarded: "for=1.2.3.4" }],
  ];
  for (const [label, headers] of cases) {
    assert.equal((await factoryPost(post("/api/factory", { action: "approve-deploy-first", project: "wf_abc123", siteHash: HASH }, headers))).status, 403, `factory: ${label}`);
    assert.equal((await contentPost(post("/api/content/action", { action: "approve-first", id: "cnt_abc123", version: VERSION }, headers))).status, 403, `content: ${label}`);
    nothingHappened(label);
  }
});

test("non-approval actions still need only the local write guard (no session): factory cancel runs", async () => {
  const res = await factoryPost(post("/api/factory", { action: "cancel", project: "wf_abc123" }, BROWSER));
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c.args), [["cancel", "wf_abc123", "--by", "dashboard"]]);
  assert.equal(calls[0].stdin, null);
  assert.equal(fx.signed.length, 0);
});

test("click 2 without the click-1 nonce (or with a malformed one) is refused with 400; nothing is signed or run", async () => {
  for (const body of [
    { action: "approve-deploy", project: "wf_abc123", siteHash: HASH },
    { action: "approve-deploy", project: "wf_abc123", siteHash: HASH, nonce: "not-a-nonce" },
    { action: "approve-deploy", project: "wf_abc123", siteHash: HASH, nonce: "a".repeat(31) },
    { action: "approve-deploy", project: "wf_abc123", siteHash: HASH, nonce: "A".repeat(32) },
  ]) {
    const res = await factoryPost(post("/api/factory", body, fx.withSession));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(((await res.json()) as { error: string }).error, /click 1 first/);
  }
  for (const body of [
    { action: "approve", id: "cnt_abc123", version: VERSION },
    { action: "approve", id: "cnt_abc123", version: VERSION, nonce: "0".repeat(16) },
  ]) {
    const res = await contentPost(post("/api/content/action", body, fx.withSession));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(((await res.json()) as { error: string }).error, /click 1 first/);
  }
  nothingHappened("click 2 without nonce");
});

test("deploy: click 1 and click 2 hand the CLI stdin JSON with the exact signed strings; argv carries --auth-stdin and never a signature", async () => {
  const t0 = nowSec();
  let res = await factoryPost(post("/api/factory", { action: "approve-deploy-first", project: "wf_abc123", siteHash: HASH }, fx.withSession));
  const j1 = (await res.json()) as { ok: boolean; nonce: string };
  assert.equal(res.status, 200); assert.equal(j1.ok, true); assert.match(j1.nonce, NONCE_SHAPE);
  assert.equal(calls.length, 1);
  const c1 = calls[0];
  assert.equal(c1.script, "factory.py");
  assert.deepEqual(c1.args, ["approve-deploy-first", "wf_abc123", "--site-hash", HASH, "--auth-stdin"]);
  const a1 = JSON.parse(c1.stdin ?? "null") as { sig: string; nonce: string; issuedAt: number };
  assert.deepEqual(Object.keys(a1).sort(), ["issuedAt", "nonce", "sig"]);
  assert.equal(a1.nonce, j1.nonce);
  assert.ok(Number.isInteger(a1.issuedAt) && a1.issuedAt >= t0 && a1.issuedAt <= t0 + 5, "issuedAt is now, in unix seconds");
  assert.deepEqual(fx.signed, [`first:deploy:wf_abc123:${HASH}:${j1.nonce}:${a1.issuedAt}`]);
  assert.equal(a1.sig, hmacHex(fx.key, fx.signed[0]));
  assert.ok(!c1.args.includes("--auth") && !c1.args.some((a) => a.includes(a1.sig)), "no signature in argv");

  res = await factoryPost(post("/api/factory", { action: "approve-deploy", project: "wf_abc123", siteHash: HASH, nonce: j1.nonce }, fx.withSession));
  const j2 = (await res.json()) as { ok: boolean; nonce?: string };
  assert.equal(res.status, 200); assert.equal(j2.ok, true); assert.equal(j2.nonce, undefined, "click 2 mints nothing");
  const c2 = calls[1];
  assert.deepEqual(c2.args, ["approve-deploy", "wf_abc123", "--site-hash", HASH, "--by", "dashboard", "--auth-stdin"]);
  const a2 = JSON.parse(c2.stdin ?? "null") as { sig: string; nonce: string; issuedAt: number };
  assert.deepEqual(Object.keys(a2).sort(), ["issuedAt", "nonce", "sig"]);
  assert.equal(a2.nonce, j1.nonce, "click 2 echoes click 1's nonce");
  assert.ok(a2.issuedAt >= a1.issuedAt && a2.issuedAt <= nowSec());
  assert.equal(fx.signed[1], `deploy:wf_abc123:${HASH}:${j1.nonce}:${a2.issuedAt}`);
  assert.equal(a2.sig, hmacHex(fx.key, fx.signed[1]));
  assert.ok(!c2.args.some((a) => a.includes(a2.sig)));
  assert.equal(fx.signed.length, 2);
});

test("deploy: a refused click 1 (the runtime said no) is 409 and returns no nonce", async () => {
  answer = { code: 1, out: JSON.stringify({ ok: false, error: "site hash does not match the reviewed site" }) };
  const res = await factoryPost(post("/api/factory", { action: "approve-deploy-first", project: "wf_abc123", siteHash: HASH }, fx.withSession));
  const j = (await res.json()) as { ok: boolean; nonce?: string; error: string };
  assert.equal(res.status, 409); assert.equal(j.ok, false); assert.equal(j.nonce, undefined); assert.match(j.error, /site hash/);
});

test("G9-5 content: the version comes from the request (the one the card displayed); the route never asks the CLI for the current version", async () => {
  const t0 = nowSec();
  let res = await contentPost(post("/api/content/action", { action: "approve-first", id: "cnt_abc123", version: VERSION }, fx.withSession));
  const j1 = (await res.json()) as { ok: boolean; nonce: string };
  assert.equal(res.status, 200); assert.match(j1.nonce, NONCE_SHAPE);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, "content_os.py");
  assert.deepEqual(calls[0].args, ["approve", "cnt_abc123", "--stage", "first", "--version", VERSION, "--by", "dashboard", "--auth-stdin"]);
  const a1 = JSON.parse(calls[0].stdin ?? "null") as { sig: string; nonce: string; issuedAt: number };
  assert.equal(a1.nonce, j1.nonce); assert.ok(a1.issuedAt >= t0);
  assert.deepEqual(fx.signed, [`first:content:cnt_abc123:${VERSION}:${j1.nonce}:${a1.issuedAt}`]);
  assert.equal(a1.sig, hmacHex(fx.key, fx.signed[0]));

  res = await contentPost(post("/api/content/action", { action: "approve", id: "cnt_abc123", version: VERSION, nonce: j1.nonce, at: "2026-11-03T15:00", note: "go" }, fx.withSession));
  assert.equal(res.status, 200);
  assert.deepEqual(calls[1].args, ["approve", "cnt_abc123", "--stage", "second", "--version", VERSION, "--by", "dashboard", "--auth-stdin", "--at", "2026-11-03T15:00", "--note", "go"]);
  const a2 = JSON.parse(calls[1].stdin ?? "null") as { sig: string; nonce: string; issuedAt: number };
  assert.equal(a2.nonce, j1.nonce);
  assert.equal(fx.signed[1], `content:cnt_abc123:${VERSION}:${j1.nonce}:${a2.issuedAt}`);
  assert.equal(a2.sig, hmacHex(fx.key, fx.signed[1]));
  assert.ok(calls.every((c) => c.args[0] !== "version"), "no server-side 'read the current version' step");
  assert.ok(calls.every((c) => !c.args.includes("--auth") && !c.args.some((a) => /^[a-f0-9]{64}$/.test(a) && a !== VERSION)), "no signature in argv");

  // A different displayed version on click 2 is signed as sent: the runtime, not the dashboard, decides it no longer matches.
  const V2 = "fedcba9876543210".repeat(4);
  res = await contentPost(post("/api/content/action", { action: "approve", id: "cnt_abc123", version: V2, nonce: j1.nonce }, fx.withSession));
  assert.equal(res.status, 200);
  assert.ok(calls[2].args.includes(V2) && !calls[2].args.includes(VERSION));
  assert.match(fx.signed[2], new RegExp(`^content:cnt_abc123:${V2}:${j1.nonce}:\\d+$`));
});

test("G9-5 content: a missing or malformed version is 400 before anything is signed", async () => {
  for (const version of [undefined, "", VERSION.toUpperCase(), VERSION.slice(0, 63), VERSION + "0", 12345]) {
    const res = await contentPost(post("/api/content/action", { action: "approve-first", id: "cnt_abc123", version }, fx.withSession));
    assert.equal(res.status, 400, String(version));
    assert.match(((await res.json()) as { error: string }).error, /reviewVersion/);
  }
  nothingHappened("bad version");
});

test("agents approve: needs the session, then still passes --auth in argv (scheduler.py has no --auth-stdin yet: G9-4 residual)", async () => {
  const res = await agentsPost(post("/api/agents/action", { action: "approve", task: "task_abc123", approvalId: "apr_abc123" }, fx.withSession));
  assert.equal(res.status, 200);
  assert.deepEqual(fx.signed, ["task:task_abc123:apr_abc123"]);
  assert.equal(calls[0].script, "scheduler.py");
  assert.deepEqual(calls[0].args, ["approve", "task_abc123", "apr_abc123", "--by", "dashboard", "--auth", hmacHex(fx.key, "task:task_abc123:apr_abc123")]);
  assert.equal(calls[0].stdin, null);
});

test("GET /api/auth/session: 401 without a session or with a forged cookie; 200 with the session's CSRF value", async () => {
  assert.equal((await sessionGet(get("/api/auth/session"))).status, 401);
  assert.equal((await sessionGet(get("/api/auth/session", { cookie: fx.forgedCookie }))).status, 401);
  const res = await sessionGet(get("/api/auth/session", { cookie: fx.cookie }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, csrf: fx.csrf });
  assert.equal(res.headers.get("cache-control"), "no-store");
});
