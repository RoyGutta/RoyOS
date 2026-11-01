import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StoreError, type KV } from "./kv";

/**
 * File-backed KV for local mode, staging and tests. One JSON document under a private directory (0700/0600), every
 * operation serialized by an in-process queue AND a lock file (O_EXCL create; stale after 10 s), read-modify-write with
 * an atomic rename. TTLs are honoured on read. Not for multi-instance hosting: the hosted app accepts it only with
 * RELAY_STAGING=1 on a loopback host (lib/continuous/mode.ts).
 */
type Entry = { v: string; exp: number | null };
type ListEntry = { v: string[]; exp: number | null };
type Doc = { kv: Record<string, Entry>; lists: Record<string, ListEntry> };

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

export function defaultFileStoreDir(): string {
  return path.join(os.tmpdir(), "jarvis-link-store");
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export function fileKV(dir?: string | null): KV {
  const root = dir && dir.trim() ? path.resolve(dir) : defaultFileStoreDir();
  const file = path.join(root, "store.json");
  const lock = path.join(root, "store.lock");
  let chain: Promise<unknown> = Promise.resolve();

  function load(): Doc {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<Doc>;
      return { kv: raw.kv && typeof raw.kv === "object" ? raw.kv : {}, lists: raw.lists && typeof raw.lists === "object" ? raw.lists : {} };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kv: {}, lists: {} };
      throw new StoreError("file store is unreadable; remove it to start over");
    }
  }
  function prune(doc: Doc, now: number) {
    for (const [k, e] of Object.entries(doc.kv)) if (e.exp !== null && e.exp <= now) delete doc.kv[k];
    for (const [k, e] of Object.entries(doc.lists)) if ((e.exp !== null && e.exp <= now) || e.v.length === 0) delete doc.lists[k];
  }
  function save(doc: Doc) {
    const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  async function acquire(): Promise<void> {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try { fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 }); return; }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw new StoreError("file store lock failed");
        try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock); } catch { /* raced; retry */ }
        if (Date.now() > deadline) throw new StoreError("file store is locked by another process");
        await sleep(5);
      }
    }
  }
  function withDoc<T>(fn: (doc: Doc, now: number) => T): Promise<T> {
    const run = async () => {
      await acquire();
      try {
        const now = Date.now();
        const doc = load();
        prune(doc, now);
        const out = fn(doc, now);
        save(doc);
        return out;
      } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  }
  const ttl = (now: number, sec?: number) => (sec && sec > 0 ? now + sec * 1000 : null);

  return {
    kind: "file",
    get: (key) => withDoc((d) => d.kv[key]?.v ?? null),
    set: (key, value, opts) => withDoc((d, now) => {
      if (opts?.nx && d.kv[key]) return false;
      d.kv[key] = { v: value, exp: ttl(now, opts?.ttlSec) };
      return true;
    }),
    del: (key) => withDoc((d) => { delete d.kv[key]; }),
    incr: (key, ttlSec) => withDoc((d, now) => {
      const e = d.kv[key] ?? { v: "0", exp: ttl(now, ttlSec) };
      e.v = String((Number(e.v) || 0) + 1);
      d.kv[key] = e;
      return Number(e.v);
    }),
    mget: (keys) => withDoc((d) => keys.map((k) => d.kv[k]?.v ?? null)),
    lpushTrim: (key, value, maxLen, ttlSec) => withDoc((d, now) => {
      const l = d.lists[key] ?? { v: [], exp: null };
      l.v.unshift(value); l.v = l.v.slice(0, Math.max(1, maxLen)); l.exp = ttl(now, ttlSec); d.lists[key] = l;
    }),
    lrange: (key) => withDoc((d) => [...(d.lists[key]?.v ?? [])]),
    lreplace: (key, oldValue, newValue, ttlSec) => withDoc((d, now) => {
      const l = d.lists[key] ?? { v: [], exp: null };
      l.v = [newValue, ...l.v.filter((x) => x !== oldValue)]; l.exp = ttl(now, ttlSec); d.lists[key] = l;
    }),
    ping: () => withDoc(() => undefined),
  };
}
