import assert from "node:assert/strict";
import { test } from "node:test";
import { StoreError } from "../lib/continuous/store/kv";
import { INCR_WITH_TTL_LUA, upstashKV, type FetchLike } from "../lib/continuous/store/upstash";

/** A fake Upstash: records every request and answers from a queue. Nothing leaves the process. */
function fakeUpstash() {
  const calls: { path: string; body: unknown; auth: string | undefined }[] = [];
  const replies: unknown[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const h = init.headers as Record<string, string>;
    calls.push({ path: url.replace("https://db.example", ""), body: JSON.parse(String(init.body)), auth: h.authorization });
    return new Response(JSON.stringify(replies.shift() ?? { result: null }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, replies, kv: upstashKV("https://db.example", "token-value", fetchImpl) };
}

test("DC-4: the counter is ONE atomic EVAL that INCRs and sets the window TTL whenever the key has none — never a SET NX + INCR pipeline", async () => {
  const f = fakeUpstash();
  f.replies.push({ result: 1 }, { result: 2 });
  assert.equal(await f.kv.incr("rl:login:global", 3600), 1);
  assert.equal(await f.kv.incr("rl:login:global", 3600), 2);
  assert.deepEqual(f.calls[0], { path: "", body: ["EVAL", INCR_WITH_TTL_LUA, 1, "jl:rl:login:global", 3600], auth: "Bearer token-value" });
  assert.deepEqual(f.calls[1].body, f.calls[0].body);
  assert.match(INCR_WITH_TTL_LUA, /^local n = redis\.call\('INCR', KEYS\[1\]\) if redis\.call\('TTL', KEYS\[1\]\) < 0 then redis\.call\('EXPIRE', KEYS\[1\], ARGV\[1\]\) end return n$/);
  assert.ok(f.calls.every((c) => c.path !== "/pipeline"), "no non-atomic pipeline");
});

test("DC-4: list writes that need a TTL are /multi-exec transactions, SET NX EX stays one command, and a refused transaction is a StoreError", async () => {
  const f = fakeUpstash();
  f.replies.push([{ result: 1 }, { result: "OK" }, { result: 1 }]);
  await f.kv.lpushTrim("cmd:log", "entry", 40, 86400);
  assert.deepEqual(f.calls[0], { path: "/multi-exec", body: [["LPUSH", "jl:cmd:log", "entry"], ["LTRIM", "jl:cmd:log", 0, 39], ["EXPIRE", "jl:cmd:log", 86400]], auth: "Bearer token-value" });
  f.replies.push([{ result: 1 }, { result: 1 }, { result: 1 }]);
  await f.kv.lreplace("cmd:log", "entry", "entry2", 86400);
  assert.deepEqual(f.calls[1].path, "/multi-exec");
  assert.deepEqual(f.calls[1].body, [["LREM", "jl:cmd:log", 0, "entry"], ["LPUSH", "jl:cmd:log", "entry2"], ["EXPIRE", "jl:cmd:log", 86400]]);
  f.replies.push({ result: "OK" });
  assert.equal(await f.kv.set("nonce:ab", "1", { nx: true, ttlSec: 600 }), true);
  assert.deepEqual(f.calls[2], { path: "", body: ["SET", "jl:nonce:ab", "1", "NX", "EX", 600], auth: "Bearer token-value" });
  f.replies.push({ result: null });
  assert.equal(await f.kv.set("nonce:ab", "1", { nx: true, ttlSec: 600 }), false, "NX refused → false");
  f.replies.push({ result: ["x", null] });
  assert.deepEqual(await f.kv.mget(["a", "b"]), ["x", null]);
  assert.deepEqual(f.calls[4].body, ["MGET", "jl:a", "jl:b"]);
  assert.ok(f.calls.every((c) => c.path === "" || c.path === "/multi-exec"), "only single commands and transactions");
  f.replies.push({ error: "ERR EXECABORT" });
  await assert.rejects(f.kv.lpushTrim("cmd:log", "z", 40, 86400), StoreError);
  f.replies.push([{ result: 1 }, { error: "WRONGTYPE" }, { result: 1 }]);
  await assert.rejects(f.kv.lreplace("cmd:log", "z", "y", 86400), StoreError);
  f.replies.push([{ result: 1 }]);
  await assert.rejects(f.kv.lpushTrim("cmd:log", "z", 40, 86400), (e: unknown) => e instanceof StoreError && /malformed/.test(e.message));
});
