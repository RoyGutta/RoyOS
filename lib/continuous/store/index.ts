import { chooseStore } from "../mode";
import { fileKV } from "./file";
import { StoreError, type KV } from "./kv";
import { upstashKV } from "./upstash";

/**
 * Store factory. Hosted mode fails closed: no configured durable store → StoreError (503) on every call site. The
 * choice is a function of the environment and (for the loopback-only staging file store) the request's Host.
 */
let cached: { sig: string; kv: KV } | null = null;
let override: KV | null = null;

export function getStore(hostHeader: string | null | undefined): KV {
  if (override) return override;
  const c = chooseStore(hostHeader);
  if (c.kind === "none") throw new StoreError(c.reason);
  const sig = c.kind === "upstash" ? `upstash:${c.url}` : `file:${c.dir ?? ""}`;
  if (cached && cached.sig === sig) return cached.kv;
  cached = { sig, kv: c.kind === "upstash" ? upstashKV(c.url, c.token) : fileKV(c.dir) };
  return cached.kv;
}

/** Tests only: inject a backend. */
export function setStoreForTests(kv: KV | null) {
  override = kv;
  cached = null;
}

export { StoreError };
export type { KV };
