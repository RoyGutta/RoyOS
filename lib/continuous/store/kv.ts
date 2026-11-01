/**
 * The one durable shared store (contract v1.1, LP-4/LP-5). Every operation is ONE atomic unit — a single Redis command,
 * a Lua EVAL, or a MULTI/EXEC transaction — so the Upstash REST backend is exact and the file backend (staging/tests)
 * emulates the same semantics under a process lock. Keys are namespaced by the backend (`jl:`); values are strings
 * (JSON where structured). The comment on each method is its Redis command count, which is what Upstash bills.
 */
export interface KV {
  readonly kind: "file" | "upstash";
  /** GET — 1. */
  get(key: string): Promise<string | null>;
  /** SET [NX] [EX ttl] — 1. Returns false only when `nx` was set and the key already existed. */
  set(key: string, value: string, opts?: { ttlSec?: number; nx?: boolean }): Promise<boolean>;
  /** DEL — 1. */
  del(key: string): Promise<void>;
  /** Fixed-window counter — 1 (EVAL): INCR, and the key gets the window TTL whenever it has none. Never a counter without a TTL. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** MGET — 1. */
  mget(keys: string[]): Promise<(string | null)[]>;
  /** LPUSH + LTRIM 0..maxLen-1 + EXPIRE — 3, in one transaction. */
  lpushTrim(key: string, value: string, maxLen: number, ttlSec: number): Promise<void>;
  /** LREM key 0 oldValue + LPUSH newValue + EXPIRE — 3, in one transaction: an entry is rewritten and moved to the head. */
  lreplace(key: string, oldValue: string, newValue: string, ttlSec: number): Promise<void>;
  /** LRANGE 0 -1 — 1. */
  lrange(key: string): Promise<string[]>;
  ping(): Promise<void>;
}

export class StoreError extends Error {
  status = 503;
  constructor(message: string) { super(message); this.name = "StoreError"; }
}
