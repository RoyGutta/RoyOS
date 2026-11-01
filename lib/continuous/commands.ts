import { randomUUID } from "node:crypto";
import { HEX16, hmacHex, safeEqual } from "./crypto";

/**
 * Commands (contract v1.1 §Commands). The dashboard SERVER builds and signs one with CMD_KEY; the Mac verifies.
 *   MAC = HMAC-SHA256(CMD_KEY, 'cmd\nv1\n'+installId+'\n'+channel+'\n'+id+'\n'+verb+'\n'+issuedAt+'\n'+expiresAt)
 * channel is "local" when the command goes to `supervisor.py link-apply`, "remote" when it is queued for the relay loop.
 */
export const VERBS = ["on", "off", "pause", "resume", "stop"] as const;
export type Verb = (typeof VERBS)[number];
export type Channel = "local" | "remote";
export const COMMAND_TTL_SEC = 120;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface SignedCommand {
  v: 1;
  installId: string;
  channel: Channel;
  id: string;
  verb: Verb;
  issuedAt: number;
  expiresAt: number;
  by: "roy";
  sig: string;
}

export function isVerb(x: unknown): x is Verb {
  return typeof x === "string" && (VERBS as readonly string[]).includes(x);
}

export function commandMacString(c: { installId: string; channel: string; id: string; verb: string; issuedAt: number; expiresAt: number }): string {
  return `cmd\nv1\n${c.installId}\n${c.channel}\n${c.id}\n${c.verb}\n${c.issuedAt}\n${c.expiresAt}`;
}

export function buildCommand(o: { verb: Verb; channel: Channel; installId: string; cmdKeyHex: string; nowSec?: number; id?: string }): SignedCommand {
  if (!isVerb(o.verb)) throw new Error("unknown verb");
  if (!HEX16.test(o.installId)) throw new Error("installId must be 16 hex characters");
  const issuedAt = Math.floor(o.nowSec ?? Date.now() / 1000);
  const base = { v: 1 as const, installId: o.installId.toLowerCase(), channel: o.channel, id: o.id ?? randomUUID(), verb: o.verb, issuedAt, expiresAt: issuedAt + COMMAND_TTL_SEC, by: "roy" as const };
  return { ...base, sig: hmacHex(o.cmdKeyHex, commandMacString(base)) };
}

export type CommandCheck = { ok: true; command: SignedCommand } | { ok: false; reason: string };

/**
 * The Mac's acceptance rules, mirrored here so tests and the hosted end-to-end run can stand in for the Mac. The
 * seen-id (24 h) check is the caller's. Signature first, in constant time; every other field is compared after.
 */
export function verifyCommand(input: unknown, o: { cmdKeyHex: string; installId: string; channel: Channel; nowSec: number }): CommandCheck {
  if (!input || typeof input !== "object") return { ok: false, reason: "not an object" };
  const c = input as Record<string, unknown>;
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  const num = (k: string) => (typeof c[k] === "number" && Number.isInteger(c[k]) ? (c[k] as number) : NaN);
  const issuedAt = num("issuedAt"), expiresAt = num("expiresAt");
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return { ok: false, reason: "issuedAt/expiresAt must be integers" };
  const expected = hmacHex(o.cmdKeyHex, commandMacString({ installId: str("installId"), channel: str("channel"), id: str("id"), verb: str("verb"), issuedAt, expiresAt }));
  if (!safeEqual(expected, str("sig").toLowerCase())) return { ok: false, reason: "bad signature" };
  if (c.v !== 1) return { ok: false, reason: "unsupported version" };
  if (str("installId").toLowerCase() !== o.installId.toLowerCase()) return { ok: false, reason: "installId is not this Mac" };
  if (str("channel") !== o.channel) return { ok: false, reason: `channel mismatch: expected ${o.channel}` };
  if (!UUID_V4.test(str("id"))) return { ok: false, reason: "id is not a uuid v4" };
  if (!isVerb(c.verb)) return { ok: false, reason: "unknown verb" };
  if (issuedAt > o.nowSec + 30) return { ok: false, reason: "issued in the future" };
  if (o.nowSec > expiresAt) return { ok: false, reason: "expired" };
  if (expiresAt - issuedAt > 300 || expiresAt < issuedAt) return { ok: false, reason: "lifetime out of range" };
  if (c.by !== "roy") return { ok: false, reason: "unknown issuer" };
  return { ok: true, command: c as unknown as SignedCommand };
}
