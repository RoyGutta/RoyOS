import { StoreError, type KV } from "./kv";

/**
 * Redis-compatible REST backend (Upstash REST API: POST <url> with a JSON command array, Bearer token; /pipeline for
 * batches). Plain fetch, no SDK. Each KV method is one atomic Redis command; the two-command pipelines below are
 * safe without a transaction (SET NX creates-with-TTL only when absent, so INCR can never lose a hit).
 * Commands per call: get 1 · set 1 · del 1 · incr 2 · mget 1 · rpush 2 · lpushTrim 3 · lrange 1 · lrem 1.
 */
const PREFIX = "jl:";
const TIMEOUT_MS = 5_000;
type Arg = string | number;
type Reply = { result?: unknown; error?: string };

export function upstashKV(url: string, token: string): KV {
  const k = (key: string) => PREFIX + key;

  async function post(pathname: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url + pathname, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    } catch { throw new StoreError("durable store unreachable"); }
    if (!res.ok) throw new StoreError(`durable store answered HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new StoreError("durable store returned a non-JSON reply"); }
  }
  async function cmd(args: Arg[]): Promise<unknown> {
    const r = (await post("", args)) as Reply;
    if (r && typeof r === "object" && "error" in r && r.error) throw new StoreError("durable store refused a command");
    return r?.result ?? null;
  }
  async function pipeline(cmds: Arg[][]): Promise<unknown[]> {
    const r = (await post("/pipeline", cmds)) as Reply[];
    if (!Array.isArray(r) || r.length !== cmds.length) throw new StoreError("durable store returned a malformed pipeline reply");
    for (const item of r) if (item && item.error) throw new StoreError("durable store refused a pipelined command");
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
    incr: async (key, ttlSec) => {
      const [, n] = await pipeline([["SET", k(key), "0", "NX", "EX", Math.ceil(ttlSec)], ["INCR", k(key)]]);
      return Number(n) || 0;
    },
    mget: async (keys) => {
      if (keys.length === 0) return [];
      const r = await cmd(["MGET", ...keys.map(k)]);
      return Array.isArray(r) ? r.map(str) : keys.map(() => null);
    },
    rpush: async (key, value, ttlSec) => { await pipeline([["RPUSH", k(key), value], ["EXPIRE", k(key), Math.ceil(ttlSec)]]); },
    lpushTrim: async (key, value, maxLen, ttlSec) => { await pipeline([["LPUSH", k(key), value], ["LTRIM", k(key), 0, Math.max(0, maxLen - 1)], ["EXPIRE", k(key), Math.ceil(ttlSec)]]); },
    lrange: async (key) => { const r = await cmd(["LRANGE", k(key), 0, -1]); return Array.isArray(r) ? r.map((x) => String(x)) : []; },
    lrem: async (key, value) => { await cmd(["LREM", k(key), 0, value]); },
    ping: async () => { if ((await cmd(["PING"])) !== "PONG") throw new StoreError("durable store did not answer PING"); },
  };
}
