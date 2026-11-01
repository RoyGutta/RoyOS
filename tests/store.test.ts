import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommand } from "../lib/continuous/commands";
import { randomHex } from "../lib/continuous/crypto";
import { hostedStatus } from "../lib/continuous/adapters/hosted";
import { LinkStore, LOG_MAX, PULL_MAX } from "../lib/continuous/linkStore";
import { chooseStore } from "../lib/continuous/mode";
import { StoreError, getStore, setStoreForTests } from "../lib/continuous/store";
import { countingKV, hostedSnapshot, tmpKV } from "./helpers";
import type { Snapshot } from "../lib/continuous/snapshot";

const installId = "0123456789abcdef";

test("file KV: SET NX, TTL expiry, windowed INCR, atomic list push/trim and replace", async () => {
  const kv = tmpKV();
  assert.equal(await kv.set("a", "1", { nx: true }), true);
  assert.equal(await kv.set("a", "2", { nx: true }), false);
  assert.equal(await kv.get("a"), "1");
  await kv.set("t", "x", { ttlSec: 1 });
  assert.equal(await kv.get("t"), "x");
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await kv.get("t"), null, "expired");
  assert.equal(await kv.incr("n", 60), 1);
  assert.equal(await kv.incr("n", 60), 2);
  for (const v of ["1", "2", "3", "4"]) await kv.lpushTrim("r", v, 3, 60);
  assert.deepEqual(await kv.lrange("r"), ["4", "3", "2"]);
  await kv.lreplace("r", "3", "3b", 60);
  assert.deepEqual(await kv.lrange("r"), ["3b", "4", "2"], "the rewritten entry moves to the head");
  await kv.lreplace("r", "nope", "5", 60);
  assert.deepEqual(await kv.lrange("r"), ["5", "3b", "4", "2"], "replacing a missing entry is a plain push");
  await kv.lreplace("new", "x", "y", 1);
  assert.deepEqual(await kv.lrange("new"), ["y"]);
  await new Promise((r) => setTimeout(r, 1100));
  assert.deepEqual(await kv.lrange("new"), [], "list TTL honoured");
  assert.deepEqual(await kv.mget(["a", "zz"]), ["1", null]);
});

test("LinkStore: snapshot round trip; enqueue → pending (oldest first, max 5) → ack → recent; expired commands drop out", async () => {
  const store = new LinkStore(tmpKV());
  const snap = hostedSnapshot(installId) as unknown as Snapshot;
  await store.putSnapshot(snap, "2026-10-31T12:05:01Z");
  assert.deepEqual(await store.getSnapshot(), { snapshot: snap, receivedAt: "2026-10-31T12:05:01Z" });
  const key = randomHex(32), now = 1_800_000_000;
  const cmds = Array.from({ length: 7 }, (_, i) => buildCommand({ verb: "pause", channel: "remote", installId, cmdKeyHex: key, nowSec: now + i }));
  for (const c of cmds) await store.enqueue(c);
  const pulled = await store.pending(now + 10);
  assert.equal(pulled.length, PULL_MAX);
  assert.deepEqual(pulled.map((c) => c.id), cmds.slice(0, 5).map((c) => c.id), "oldest first");
  assert.equal(await store.ack(cmds[0].id, true, "paused", "2026-10-31T12:06:00Z"), "acked");
  assert.equal(await store.ack(cmds[0].id, true, "paused", "2026-10-31T12:06:01Z"), "already");
  assert.equal(await store.ack("5a9d2c3e-1f2a-4b3c-8d4e-5f6a7b8c9d0e", true, "x", "2026-10-31T12:06:01Z"), "unknown");
  assert.deepEqual((await store.pendingSummary()).map((p) => p.id), cmds.slice(1).map((c) => c.id));
  const recent = await store.recent();
  assert.equal(recent[0].id, cmds[0].id); assert.equal(recent[0].ok, true); assert.equal(recent[0].message, "paused");
  const later = await store.pending(now + 6 + 121);
  assert.equal(later.length, 0, "everything else expired (120 s after the last issuedAt)");
  assert.equal((await store.pendingSummary()).length, 0);
  assert.ok((await store.recent()).some((r) => r.status === "expired"));
});

test("DC-5: a hosted status read is exactly two store commands — MGET (session + snapshot) and one LRANGE of the command log", async () => {
  const counted = countingKV(tmpKV());
  const store = new LinkStore(counted.kv);
  const now = 1_800_000_000, sid = "a".repeat(32), csrf = "c".repeat(64);
  await store.createSession(sid, csrf, now);
  await store.putSnapshot(hostedSnapshot(installId) as unknown as Snapshot, "2026-10-31T12:05:01Z");
  const key = randomHex(32);
  const c1 = buildCommand({ verb: "pause", channel: "remote", installId, cmdKeyHex: key, nowSec: now });
  const c2 = buildCommand({ verb: "resume", channel: "remote", installId, cmdKeyHex: key, nowSec: now + 1 });
  await store.enqueue(c1); await store.enqueue(c2);
  await store.ack(c1.id, true, "paused", "2026-10-31T12:06:00Z");
  counted.calls.length = 0;
  const h = await hostedStatus(store, sid, now + 2);
  assert.deepEqual(counted.calls, ["mget", "lrange"]);
  assert.ok(h);
  assert.equal(h.session.csrf, csrf);
  assert.equal(h.snapshot?.supervisor.display, "running"); assert.equal(h.receivedAt, "2026-10-31T12:05:01Z");
  assert.deepEqual(h.pending, [{ id: c2.id, verb: "resume", issuedAt: now + 1 }]);
  assert.equal(h.recent[0].id, c1.id); assert.equal(h.recent[0].ok, true);
  counted.calls.length = 0;
  assert.equal(await hostedStatus(store, "b".repeat(32), now + 2), null, "unknown session");
  assert.deepEqual(counted.calls, ["mget"], "nothing else is read without a session");
  const late = await hostedStatus(store, sid, now + 1 + 121);
  assert.deepEqual(late?.pending, [], "a pending command past its expiry is not shown as waiting");
  assert.equal(late?.recent.find((r) => r.id === c2.id)?.status, "expired", "it is shown as expired before the Mac's next pull marks it");
  for (let i = 0; i < LOG_MAX + 5; i++) await store.recordLocalResult(buildCommand({ verb: "on", channel: "local", installId, cmdKeyHex: key, nowSec: now + 10 + i }), true, "x", "2026-10-31T12:07:00Z");
  assert.equal((await store.commandLog(now + 100)).recent.length, 20, "recent is capped");
});

test("store choice: hosted mode fails closed without a durable store; the file store needs RELAY_STAGING=1 on loopback", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["JARVIS_HOSTED", "RELAY_STORE", "RELAY_STAGING", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
    setStoreForTests(null);
    process.env.JARVIS_HOSTED = "1";
    assert.equal(chooseStore("jarvis.example").kind, "none");
    assert.throws(() => getStore("jarvis.example"), StoreError);
    process.env.RELAY_STORE = "file";
    assert.equal(chooseStore("127.0.0.1:4000").kind, "none", "file without RELAY_STAGING");
    process.env.RELAY_STAGING = "1";
    assert.equal(chooseStore("127.0.0.1:4000").kind, "file");
    assert.equal(chooseStore("jarvis.example").kind, "none", "file store never serves a public host");
    delete process.env.RELAY_STORE; delete process.env.RELAY_STAGING;
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"; process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    assert.equal(chooseStore("jarvis.example").kind, "upstash");
    process.env.UPSTASH_REDIS_REST_URL = "http://example.upstash.io";
    assert.equal(chooseStore("jarvis.example").kind, "none", "plain http is refused");
    delete process.env.JARVIS_HOSTED; delete process.env.UPSTASH_REDIS_REST_URL;
    assert.equal(chooseStore("127.0.0.1:4318").kind, "file", "local default");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setStoreForTests(null);
  }
});
