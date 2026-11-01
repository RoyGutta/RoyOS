import type { SignedCommand } from "./commands";
import type { Snapshot } from "./snapshot";
import type { KV } from "./store/kv";

/**
 * Everything the contract says must live in ONE durable store, expressed over the KV: Mac nonces, rate limits and
 * lockouts, the latest snapshot, pending commands and their acks (24 h), session records with their CSRF value, and
 * the TOTP step replay guard. No module-level state anywhere in this file.
 */
export const NONCE_TTL_SEC = 600;
export const COMMAND_KEEP_SEC = 24 * 3600;
export const RECENT_MAX = 20;
export const PULL_MAX = 5;
export const SESSION_TTL_SEC = 12 * 3600;

export interface StoredSnapshot { snapshot: Snapshot; receivedAt: string }
export interface CommandRecord { command: SignedCommand; status: "pending" | "done" | "expired"; ok: boolean | null; message: string | null; ackedAt: string | null }
export interface SessionRecord { csrf: string; iat: number; exp: number }
export type AckOutcome = "acked" | "already" | "unknown";

const text120 = (s: unknown) => (typeof s === "string" ? s.replace(/[\p{C}]/gu, " ").slice(0, 120) : "");

export class LinkStore {
  private kv: KV;
  constructor(kv: KV) { this.kv = kv; }

  // ---- relay nonces --------------------------------------------------------------------------------------------
  claimNonce(nonce: string): Promise<boolean> {
    return this.kv.set(`nonce:${nonce}`, "1", { nx: true, ttlSec: NONCE_TTL_SEC });
  }

  // ---- rate limits and lockouts (fixed windows, atomic INCR) ---------------------------------------------------
  async hit(bucket: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    const count = await this.kv.incr(`rl:${bucket}`, windowSec);
    return { allowed: count <= limit, count };
  }
  async clearHits(bucket: string): Promise<void> { await this.kv.del(`rl:${bucket}`); }
  async isLocked(id: string): Promise<boolean> { return (await this.kv.get(`lock:${id}`)) !== null; }
  async lock(id: string, sec: number): Promise<void> { await this.kv.set(`lock:${id}`, "1", { ttlSec: sec }); }

  // ---- snapshot ------------------------------------------------------------------------------------------------
  async putSnapshot(snapshot: Snapshot, receivedAt: string): Promise<void> {
    await this.kv.set("snapshot", JSON.stringify({ snapshot, receivedAt }));
  }
  async getSnapshot(): Promise<StoredSnapshot | null> {
    const raw = await this.kv.get("snapshot");
    if (!raw) return null;
    try { const v = JSON.parse(raw) as StoredSnapshot; return v && v.snapshot && typeof v.receivedAt === "string" ? v : null; } catch { return null; }
  }

  // ---- commands ------------------------------------------------------------------------------------------------
  async enqueue(command: SignedCommand): Promise<void> {
    const rec: CommandRecord = { command, status: "pending", ok: null, message: null, ackedAt: null };
    await this.kv.set(`cmd:${command.id}`, JSON.stringify(rec), { ttlSec: COMMAND_KEEP_SEC });
    await this.kv.rpush("cmd:pending", command.id, COMMAND_KEEP_SEC);
  }
  private async records(ids: string[]): Promise<(CommandRecord | null)[]> {
    if (ids.length === 0) return [];
    return (await this.kv.mget(ids.map((id) => `cmd:${id}`))).map((raw) => { try { return raw ? (JSON.parse(raw) as CommandRecord) : null; } catch { return null; } });
  }
  /** Pending and not expired, oldest first. Expired or vanished entries are dropped from the pending list as a side effect. */
  async pending(nowSec: number, max = PULL_MAX): Promise<SignedCommand[]> {
    const ids = await this.kv.lrange("cmd:pending");
    const recs = await this.records(ids);
    const out: SignedCommand[] = [];
    for (let i = 0; i < ids.length; i++) {
      const r = recs[i];
      if (!r || r.status !== "pending") { await this.kv.lrem("cmd:pending", ids[i]); continue; }
      if (r.command.expiresAt < nowSec) {
        await this.kv.set(`cmd:${ids[i]}`, JSON.stringify({ ...r, status: "expired", ok: false, message: "expired before the Mac pulled it" }), { ttlSec: COMMAND_KEEP_SEC });
        await this.kv.lrem("cmd:pending", ids[i]);
        await this.kv.lpushTrim("cmd:recent", ids[i], RECENT_MAX, COMMAND_KEEP_SEC);
        continue;
      }
      out.push(r.command);
      if (out.length >= max) break;
    }
    return out;
  }
  async pendingSummary(): Promise<{ id: string; verb: string; issuedAt: number }[]> {
    const ids = await this.kv.lrange("cmd:pending");
    const recs = await this.records(ids);
    return recs.filter((r): r is CommandRecord => !!r && r.status === "pending").map((r) => ({ id: r.command.id, verb: r.command.verb, issuedAt: r.command.issuedAt }));
  }
  async ack(id: string, ok: boolean, message: unknown, nowIso: string): Promise<AckOutcome> {
    const [raw] = await this.kv.mget([`cmd:${id}`]);
    if (!raw) return "unknown";
    let rec: CommandRecord;
    try { rec = JSON.parse(raw) as CommandRecord; } catch { return "unknown"; }
    if (rec.status === "done") return "already";
    await this.kv.set(`cmd:${id}`, JSON.stringify({ ...rec, status: "done", ok, message: text120(message), ackedAt: nowIso }), { ttlSec: COMMAND_KEEP_SEC });
    await this.kv.lrem("cmd:pending", id);
    await this.kv.lpushTrim("cmd:recent", id, RECENT_MAX, COMMAND_KEEP_SEC);
    return "acked";
  }
  /** Local mode records the result of a `link-apply` the same way, so "last command" survives a reload. */
  async recordLocalResult(command: SignedCommand, ok: boolean, message: unknown, nowIso: string): Promise<void> {
    const rec: CommandRecord = { command, status: "done", ok, message: text120(message), ackedAt: nowIso };
    await this.kv.set(`cmd:${command.id}`, JSON.stringify(rec), { ttlSec: COMMAND_KEEP_SEC });
    await this.kv.lpushTrim("cmd:recent", command.id, RECENT_MAX, COMMAND_KEEP_SEC);
  }
  async recent(): Promise<{ id: string; verb: string; ok: boolean | null; message: string | null; ackedAt: string | null; status: string }[]> {
    const ids = await this.kv.lrange("cmd:recent");
    const recs = await this.records(ids);
    return recs.filter((r): r is CommandRecord => !!r).map((r) => ({ id: r.command.id, verb: r.command.verb, ok: r.ok, message: r.message, ackedAt: r.ackedAt, status: r.status }));
  }

  // ---- sessions ------------------------------------------------------------------------------------------------
  async createSession(sid: string, csrf: string, nowSec: number): Promise<SessionRecord> {
    const rec: SessionRecord = { csrf, iat: nowSec, exp: nowSec + SESSION_TTL_SEC };
    await this.kv.set(`session:${sid}`, JSON.stringify(rec), { ttlSec: SESSION_TTL_SEC });
    return rec;
  }
  async getSession(sid: string, nowSec: number): Promise<SessionRecord | null> {
    const raw = await this.kv.get(`session:${sid}`);
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw) as SessionRecord;
      if (typeof rec.csrf !== "string" || typeof rec.exp !== "number" || typeof rec.iat !== "number") return null;
      if (rec.exp <= nowSec || rec.exp - rec.iat > SESSION_TTL_SEC) return null;
      return rec;
    } catch { return null; }
  }
  async deleteSession(sid: string): Promise<void> { await this.kv.del(`session:${sid}`); }

  // ---- TOTP replay guard ---------------------------------------------------------------------------------------
  claimTotpStep(counter: number): Promise<boolean> {
    return this.kv.set(`totp:${counter}`, "1", { nx: true, ttlSec: 120 });
  }
}
