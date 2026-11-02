import assert from "node:assert/strict";
import { test } from "node:test";
import { hmacHex, randomHex } from "../lib/continuous/crypto";
import { loginNextPath } from "../lib/continuous/mode";
import { setSignerForTests } from "../lib/jarvis/approvalAuth";
import { isOutboundReviewCard, outboundStep, redact, redactApprovalForCard } from "../lib/jarvis/redact";
import { CONTENT_VERSION, NONCE, SITE_HASH, firstClick, mintNonce, secondClick } from "../lib/jarvis/twoClick";
import type { PendingApproval } from "../lib/jarvis/types";

const PHONE = "+15550000001";
const TEXT = `STEP 2 of 2 — send the reviewed message to Alex Kim <${PHONE}> via Messages now? Exact text: «Courts at 6? token=abcdef123456»`;
const base: PendingApproval = { id: "apr_1", tool: "mcp__jarvis__outbound_send", description: `final send to ${PHONE}`, target: PHONE, fullText: TEXT, reversible: false };

test("OB-10 card: outbound_review / outbound_send (with or without the prefix) keep fullText verbatim on the local dashboard; every other field is masked", () => {
  for (const tool of ["mcp__jarvis__outbound_review", "outbound_review", "mcp__jarvis__outbound_send", "outbound_send"]) {
    const out = redactApprovalForCard({ ...base, tool }, false);
    assert.equal(out.fullText, TEXT, tool);
    assert.equal(out.target, "[redacted-phone]", tool);
    assert.equal(out.description, "final send to [redacted-phone]", tool);
    assert.equal(out.reversible, false); assert.equal(out.id, "apr_1");
    assert.ok(isOutboundReviewCard({ tool }));
  }
  assert.equal(outboundStep({ tool: "mcp__jarvis__outbound_review" }), 1);
  assert.equal(outboundStep({ tool: "outbound_send" }), 2);
  assert.equal(outboundStep({ tool: "mcp__jarvis__telephony_execute" }), null);
  assert.equal(redactApprovalForCard({ ...base, fullText: "x".repeat(5000) }, false).fullText?.length, 4000, "capped like the runtime");
});

test("OB-10 card: the exception is only that card — other tools, a missing tool, prefix look-alikes and hosted mode are masked", () => {
  for (const tool of ["mcp__jarvis__telephony_execute", "Bash", "outbound_prepare", "my_outbound_send", "outbound_send2", "jarvis__outbound_send", ""]) {
    const out = redactApprovalForCard({ ...base, tool }, false);
    assert.equal(out.fullText, redact(TEXT), tool || "(no tool)");
    assert.ok(!out.fullText?.includes(PHONE) && out.fullText?.includes("[redacted-phone]") && out.fullText?.includes("token=[redacted]"));
    assert.equal(isOutboundReviewCard({ tool }), false);
  }
  const hosted = redactApprovalForCard(base, true);
  assert.equal(hosted.fullText, redact(TEXT), "hosted mode never shows an unmasked card");
  assert.equal(redactApprovalForCard({ tool: "outbound_send", description: "d" }, false).fullText, undefined, "no fullText → none invented");
});

test("two clicks: click 1 mints a 32-hex nonce and a unix-seconds issuedAt and signs first:<scope>:<nonce>:<issuedAt>; click 2 signs <scope>:<nonce>:<issuedAt2>", () => {
  const key = randomHex(32), signed: string[] = [];
  setSignerForTests((m) => { signed.push(m); return hmacHex(key, m); });
  try {
    const scope = "deploy:wf_abc123:deadbeefcafe";
    const c1 = firstClick(scope, 1_800_000_000_999);
    assert.match(c1.nonce, NONCE); assert.equal(c1.issuedAt, 1_800_000_000);
    assert.deepEqual(JSON.parse(c1.stdin), { sig: hmacHex(key, `first:${scope}:${c1.nonce}:1800000000`), nonce: c1.nonce, issuedAt: 1_800_000_000 });
    const c2 = secondClick(scope, c1.nonce, 1_800_000_003_000);
    assert.equal(c2.nonce, c1.nonce); assert.equal(c2.issuedAt, 1_800_000_003);
    assert.deepEqual(JSON.parse(c2.stdin), { sig: hmacHex(key, `${scope}:${c1.nonce}:1800000003`), nonce: c1.nonce, issuedAt: 1_800_000_003 });
    assert.deepEqual(signed, [`first:${scope}:${c1.nonce}:1800000000`, `${scope}:${c1.nonce}:1800000003`]);
    const c2b = secondClick("content:cnt_abc123:" + "a".repeat(64), c1.nonce, 1_800_000_004_000, "|at=2026-11-03T15:00-05:00");   // G9v2-1
    assert.equal(signed.pop(), `content:cnt_abc123:${"a".repeat(64)}|at=2026-11-03T15:00-05:00:${c1.nonce}:1800000004`); assert.equal(c2b.nonce, c1.nonce);
    assert.throws(() => secondClick(scope, "nope"), /32 hex/);
    assert.throws(() => secondClick(scope, c1.nonce.toUpperCase()), /32 hex/);
    assert.equal(signed.length, 2, "a refused click 2 signs nothing");
    const nonces = new Set(Array.from({ length: 50 }, () => mintNonce()));
    assert.equal(nonces.size, 50); for (const n of nonces) assert.match(n, NONCE);
  } finally { setSignerForTests(null); }
  assert.ok(SITE_HASH.test("deadbeefcafe") && SITE_HASH.test("a".repeat(64)) && !SITE_HASH.test("deadbeefcaf") && !SITE_HASH.test("DEADBEEFCAFE"));
  assert.ok(CONTENT_VERSION.test("0".repeat(64)) && !CONTENT_VERSION.test("0".repeat(63)) && !CONTENT_VERSION.test("A".repeat(64)));
});

test("login next: only a page of this dashboard; the approval pages only in local mode; anything else goes to /continuous", () => {
  assert.equal(loginNextPath("/factory", false), "/factory");
  assert.equal(loginNextPath("/content", false), "/content");
  assert.equal(loginNextPath("/", false), "/");
  assert.equal(loginNextPath("/factory", true), "/continuous");
  assert.equal(loginNextPath("/system", true), "/system");
  for (const bad of ["https://evil.example", "//evil.example", "/factory/../login", "/factory?x=1", "", undefined, 42]) assert.equal(loginNextPath(bad, false), "/continuous", String(bad));
});
