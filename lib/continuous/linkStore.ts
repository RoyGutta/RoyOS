import type { SignedCommand } from "./commands";
import type { Snapshot } from "./snapshot";
import type { KV } from "./store/kv";

/**
 * Everything the contract says must live in ONE durable store, expressed over the KV: Mac nonces, rate limits and
 * lockouts, the latest snapshot, the command log (pending commands and their acks, 24 h), session records with their
 * CSRF value, and the TOTP step replay guard. No module-level state anywhere in this file.
 *
 * Budget (DC-5): the browser's status read is TWO store commands — one MGET (session + snapshot) and one LRANGE of the
 * command log — so every command record lives as a self-describing entry of one list (`cmd:log`, newest first, at most
 * LOG_MAX entries). Enqueue is an atomic LPUSH+LTRIM+EXPIRE; an ack or an expiry rewrites the entry atomically
 * (LREM+LPUSH+EXPIRE). The log holds at most 20 live pending commands (10/min, 120 s TTL) plus RECENT_MAX results.
 */
export const NONCE_TTL_SEC = 600;
export const COMMAND_KEEP_SEC = 24 * 3600;
export const RECENT_MAX = 20;
export const PULL_MAX = 5;
export const LOG_MAX = 40;
export const SESSION_TTL_SEC = 12 * 3600;
export const EXPIRED_MESSAGE = "expired before the Mac pulled it";
const LOG = "cmd:log";

export interface StoredSnapshot { snapshot: Snapshot; receivedAt: string }
export interface CommandRecord { command: SignedCommand; status: "pending" | "done" | "expired"; ok: boolean | null; message: string | null; ackedAt: string | null }
export interface SessionRecord { csrf: string; iat: number; exp: number }
export interface PendingSummary { id: string; verb: string; issuedAt: number }
export interface RecentEntry { id: string; verb: string; ok: boolean | null; message: string | null; ackedAt: string | null; status: string }
export type AckOutcome = "acked" | "already" | "unknown";

const text120 = (s: unknown) => (typeof s === "string" ? s.replace(/[\p{C}]/gu, " ").slice(0, 120) : "");
const nowSecDefault = () => Math.floor(Date.now() / 1000);

function parseSession(raw: string | null, nowSec: number): SessionRecord | null {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as SessionRecord;
    if (typeof rec.csrf !== "string" || typeof rec.exp !== "number" || typeof rec.iat !== "number") return null;
    if (rec.exp <= nowSec || rec.exp - rec.iat > SESSION_TTL_SEC) return null;
    return rec;
  } catch { return null; }
}
function parseSnapshot(raw: string | null): StoredSnapshot | null {
  if (!raw) return null;
  try { const v = JSON.parse(raw) as StoredSnapshot; return v && v.snapshot && typeof v.receivedAt === "string" ? v : null; } catch { return null; }
}

export class LinkStore {
  private kv: KV;
  constructor(kv: KV) { this.kv = kv; }

  // ---- relay nonces --------------------------------------------------------------------------------------------
  claimNonce(nonce: string): Promise<boolean> {
    return this.kv.set(`nonce:${nonce}`, "1", { nx: true, ttlSec: NONCE_TTL_SEC });
  }

  // ---- rate limits and lockouts (fixed windows, atomic INCR with TTL) ------------------------------------------
  async hit(bucket: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    const count = await this.kv.incr(`rl:${bucket}`, windowSec);
    return { allowed: count <= limit, count };
  }
  async clearHits(bucket: string): Promise<void> { await this.kv.del(`rl:${bucket}`); }
  async isLocked(id: string): Promise<boolean> { return (await this.kv.get(`lock:${id}`)) !== null; }
  async lock(id: string, sec: number): Promise<void> { await this.kv.set(`lock:${id}`, "1", { ttlSec: sec }); }
  /** The login gate in ONE read: this client's lockout and the global failure count (DC-1). */
  async loginGate(client: string): Promise<{ locked: boolean; globalFails: number }> {
    const [lock, global] = await this.kv.mget([`lock:${client}`, "rl:login:global"]);
    return { locked: lock !== null, globalFails: Number(global) || 0 };
  }

  // ---- snapshot ------------------------------------------------------------------------------------------------
  async putSnapshot(snapshot: Snapshot, receivedAt: string): Promise<void> {
    await this.kv.set("snapshot", JSON.stringify({ snapshot, receivedAt }));
  }
  async getSnapshot(): Promise<StoredSnapshot | null> { return parseSnapshot(await this.kv.get("snapshot")); }
  /** Status read, part 1 of 2: the session record and the latest snapshot in one MGET. */
  async sessionAndSnapshot(sid: string, nowSec: number): Promise<{ session: SessionRecord | null; stored: StoredSnapshot | null }> {
    const [s, snap] = await this.kv.mget([`session:${sid}`, "snapshot"]);
    return { session: parseSession(s, nowSec), stored: parseSnapshot(snap) };
  }

  // ---- command log ---------------------------------------------------------------------------------------------
  private entry(rec: CommandRecord): string { return JSON.stringify(rec); }
  /** The whole log, newest first; entries that do not parse are skipped. One LRANGE. */
  private async log(): Promise<{ raw: string; rec: CommandRecord }[]> {
    const out: { raw: string; rec: CommandRecord }[] = [];
    for (const raw of await this.kv.lrange(LOG)) {
      try {
        const rec = JSON.parse(raw) as CommandRecord;
        if (rec && rec.command && typeof rec.command.id === "string" && typeof rec.status === "string") out.push({ raw, rec });
      } catch { /* skipped */ }
    }
    return out;
  }
  private async rewrite(raw: string, rec: CommandRecord): Promise<void> { await this.kv.lreplace(LOG, raw, this.entry(rec), COMMAND_KEEP_SEC); }
  private static expired(rec: CommandRecord): CommandRecord { return { ...rec, status: "expired", ok: false, message: EXPIRED_MESSAGE, ackedAt: null }; }

  async enqueue(command: SignedCommand): Promise<void> {
    await this.kv.lpushTrim(LOG, this.entry({ command, status: "pending", ok: null, message: null, ackedAt: null }), LOG_MAX, COMMAND_KEEP_SEC);
  }
  /** The Mac's pull: pending and not expired, oldest first, at most `max`. Expired entries are marked as a side effect. */
  async pending(nowSec: number, max = PULL_MAX): Promise<SignedCommand[]> {
    const out: SignedCommand[] = [];
    for (const { raw, rec } of (await this.log()).reverse()) {
      if (rec.status !== "pending") continue;
      if (rec.command.expiresAt < nowSec) { await this.rewrite(raw, LinkStore.expired(rec)); continue; }
      out.push(rec.command);
      if (out.length >= max) break;
    }
    return out;
  }
  /** Status read, part 2 of 2: pending commands (oldest first) and the newest results, from ONE LRANGE. A pending
   *  command past its expiry is shown as expired even before the Mac's next pull marks it in the store. */
  async commandLog(nowSec = nowSecDefault()): Promise<{ pending: PendingSummary[]; recent: RecentEntry[] }> {
    const pending: PendingSummary[] = [];
    const recent: RecentEntry[] = [];
    for (const { rec } of await this.log()) {
      const r = rec.status === "pending" && rec.command.expiresAt < nowSec ? LinkStore.expired(rec) : rec;
      if (r.status === "pending") pending.unshift({ id: r.command.id, verb: r.command.verb, issuedAt: r.command.issuedAt });
      else if (recent.length < RECENT_MAX) recent.push({ id: r.command.id, verb: r.command.verb, ok: r.ok, message: r.message, ackedAt: r.ackedAt, status: r.status });
    }
    return { pending, recent };
  }
  async pendingSummary(nowSec = nowSecDefault()): Promise<PendingSummary[]> { return (await this.commandLog(nowSec)).pending; }
  async recent(nowSec = nowSecDefault()): Promise<RecentEntry[]> { return (await this.commandLog(nowSec)).recent; }
  /** Marks a pending command done. A record that is already done or expired is final ("already"). */
  async ack(id: string, ok: boolean, message: unknown, nowIso: string): Promise<AckOutcome> {
    const hit = (await this.log()).find((e) => e.rec.command.id === id);
    if (!hit) return "unknown";
    if (hit.rec.status !== "pending") return "already";
    await this.rewrite(hit.raw, { ...hit.rec, status: "done", ok, message: text120(message), ackedAt: nowIso });
    return "acked";
  }
  /** Local mode records the result of a `link-apply` the same way, so "last command" survives a reload. */
  async recordLocalResult(command: SignedCommand, ok: boolean, message: unknown, nowIso: string): Promise<void> {
    await this.kv.lpushTrim(LOG, this.entry({ command, status: "done", ok, message: text120(message), ackedAt: nowIso }), LOG_MAX, COMMAND_KEEP_SEC);
  }

  // ---- sessions ------------------------------------------------------------------------------------------------
  async createSession(sid: string, csrf: string, nowSec: number): Promise<SessionRecord> {
    const rec: SessionRecord = { csrf, iat: nowSec, exp: nowSec + SESSION_TTL_SEC };
    await this.kv.set(`session:${sid}`, JSON.stringify(rec), { ttlSec: SESSION_TTL_SEC });
    return rec;
  }
  async getSession(sid: string, nowSec: number): Promise<SessionRecord | null> { return parseSession(await this.kv.get(`session:${sid}`), nowSec); }
  async deleteSession(sid: string): Promise<void> { await this.kv.del(`session:${sid}`); }

  // ---- TOTP replay guard ---------------------------------------------------------------------------------------
  claimTotpStep(counter: number): Promise<boolean> {
    return this.kv.set(`totp:${counter}`, "1", { nx: true, ttlSec: 120 });
  }
}
