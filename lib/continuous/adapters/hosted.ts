import { buildCommand, type Verb } from "../commands";
import type { LinkKeys } from "../config";
import type { LinkStore, PendingSummary, RecentEntry, SessionRecord } from "../linkStore";
import type { Snapshot } from "../snapshot";

/**
 * Hosted adapter: status is whatever the Mac last reported into the durable store; a command is signed on the
 * "remote" channel and queued for the Mac's next pull (the relay loop runs every 30 s: report, pull, apply, ack).
 */
export interface HostedStatus { session: SessionRecord; snapshot: Snapshot | null; receivedAt: string | null; pending: PendingSummary[]; recent: RecentEntry[] }

/** Exactly two store commands (DC-5): MGET session + snapshot, then one LRANGE of the command log. Null = no session. */
export async function hostedStatus(store: LinkStore, sid: string, nowSec: number): Promise<HostedStatus | null> {
  const { session, stored } = await store.sessionAndSnapshot(sid, nowSec);
  if (!session) return null;
  const { pending, recent } = await store.commandLog(nowSec);
  return { session, snapshot: stored?.snapshot ?? null, receivedAt: stored?.receivedAt ?? null, pending, recent };
}

export async function hostedCommand(store: LinkStore, keys: LinkKeys, verb: Verb, nowSec: number) {
  const command = buildCommand({ verb, channel: "remote", installId: keys.installId, cmdKeyHex: keys.cmdKey, nowSec });
  await store.enqueue(command);
  return { id: command.id, ok: true as const, message: "queued; the Mac applies it on its next pull (≤ 30 s)", queued: true as const };
}
