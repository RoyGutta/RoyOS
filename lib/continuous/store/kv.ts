/**
 * The one durable shared store (contract v1.1, LP-4/LP-5). Every operation maps 1:1 onto an atomic Redis command so the
 * Upstash REST backend is exact and the file backend (staging/tests) emulates the same semantics under a process lock.
 * Keys are namespaced by the backend (`jl:`); values are strings (JSON where structured).
 */
export interface KV {
  readonly kind: "file" | "upstash";
  get(key: string): Promise<string | null>;
  /** SET [NX] [EX ttl]. Returns false only when `nx` was set and the key already existed. */
  set(key: string, value: string, opts?: { ttlSec?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Counter with a fixed window: created with the TTL on first hit, then INCR. Returns the count after this hit. */
  incr(key: string, ttlSec: number): Promise<number>;
  mget(keys: string[]): Promise<(string | null)[]>;
  /** RPUSH + EXPIRE (ttl refreshed on each push). */
  rpush(key: string, value: string, ttlSec: number): Promise<void>;
  /** LPUSH + LTRIM 0..maxLen-1 + EXPIRE. */
  lpushTrim(key: string, value: string, maxLen: number, ttlSec: number): Promise<void>;
  lrange(key: string): Promise<string[]>;
  /** LREM key 0 value. */
  lrem(key: string, value: string): Promise<void>;
  ping(): Promise<void>;
}

export class StoreError extends Error {
  status = 503;
  constructor(message: string) { super(message); this.name = "StoreError"; }
}
