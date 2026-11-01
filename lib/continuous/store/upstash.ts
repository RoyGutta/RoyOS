import { StoreError, type KV } from "./kv";

/**
 * Redis-compatible REST backend (Upstash REST API: POST <url> with a JSON command array, Bearer token; /multi-exec for
 * a MULTI/EXEC transaction). Plain fetch, no SDK. Every KV method is ONE atomic unit — a single command, a Lua EVAL, or
 * a /multi-exec transaction — never a /pipeline, which is not atomic: a counter created by `SET NX EX` and then
 * `INCR`ed in a pipeline can expire in between and be re-created by the INCR with no TTL at all (a lockout or a
 * command 429 that never ends). The counter is therefore one EVAL that INCRs and gives the key its TTL when it has none.
 * Commands per call: get 1 · set 1 · del 1 · incr 1 · mget 1 · lpushTrim 3 · lreplace 3 · lrange 1 · ping 1.
 */
const PREFIX = "jl:";
const TIMEOUT_MS = 5_000;
type Arg = string | number;
type Reply = { result?: unknown; error?: string };
/** INCR; then, if the key has no TTL (fresh, or one that somehow lost it), EXPIRE it for the window. Returns the count. */
export const INCR_WITH_TTL_LUA = "local n = redis.call('INCR', KEYS[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function upstashKV(url: string, token: string, fetchImpl: FetchLike = (u, init) => fetch(u, init)): KV {
  const k = (key: string) => PREFIX + key;

  async function post(pathname: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(url + pathname, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    } catch { throw new StoreError("durable store unreachable"); }
    if (!res.ok) throw new StoreError(`durable store answered HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new StoreError("durable store returned a non-JSON reply"); }
  }
  async function cmd(args: Arg[]): Promise<unknown> {
    const r = (await post("", args)) as Reply;
    if (r && typeof r === "object" && "error" in r && r.error) throw new StoreError("durable store refused a command");
    return r?.result ?? null;
  }
  /** MULTI/EXEC: all commands run atomically or none does. The reply is one result per command, like a pipeline's. */
  async function transaction(cmds: Arg[][]): Promise<unknown[]> {
    const r = (await post("/multi-exec", cmds)) as Reply[] | Reply;
    if (!Array.isArray(r)) throw new StoreError("durable store refused a transaction");
    if (r.length !== cmds.length) throw new StoreError("durable store returned a malformed transaction reply");
    for (const item of r) if (item && item.error) throw new StoreError("durable store refused a transactional command");
    return r.map((x) => x?.result ?? null);
  }
  const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

  return {
    kind: "upstash",
    get: async (key) => str(await cmd(["GET", k(key)])),
    set: async (key, value, opts) => {
      const args: Arg[] = ["SET", k(key), value];
      if (opts?.nx) args.push("NX");
      if (opts?.ttlSec && opts.ttlSec > 0) args.push("EX", Math.ceil(opts.ttlSec));
      return (await cmd(args)) === "OK";
    },
    del: async (key) => { await cmd(["DEL", k(key)]); },
    incr: async (key, ttlSec) => Number(await cmd(["EVAL", INCR_WITH_TTL_LUA, 1, k(key), Math.ceil(ttlSec)])) || 0,
    mget: async (keys) => {
      if (keys.length === 0) return [];
      const r = await cmd(["MGET", ...keys.map(k)]);
      return Array.isArray(r) ? r.map(str) : keys.map(() => null);
    },
    lpushTrim: async (key, value, maxLen, ttlSec) => { await transaction([["LPUSH", k(key), value], ["LTRIM", k(key), 0, Math.max(0, maxLen - 1)], ["EXPIRE", k(key), Math.ceil(ttlSec)]]); },
    lreplace: async (key, oldValue, newValue, ttlSec) => { await transaction([["LREM", k(key), 0, oldValue], ["LPUSH", k(key), newValue], ["EXPIRE", k(key), Math.ceil(ttlSec)]]); },
    lrange: async (key) => { const r = await cmd(["LRANGE", k(key), 0, -1]); return Array.isArray(r) ? r.map((x) => String(x)) : []; },
    ping: async () => { if ((await cmd(["PING"])) !== "PONG") throw new StoreError("durable store did not answer PING"); },
  };
}
