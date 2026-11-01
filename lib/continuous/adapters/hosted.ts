import { buildCommand, type Verb } from "../commands";
import type { LinkKeys } from "../config";
import type { LinkStore } from "../linkStore";

/**
 * Hosted adapter: status is whatever the Mac last reported into the durable store; a command is signed on the
 * "remote" channel and queued for the Mac's next pull (the relay loop polls every 15 s, applies, then acks).
 */
export async function hostedStatus(store: LinkStore) {
  const [stored, pending, recent] = await Promise.all([store.getSnapshot(), store.pendingSummary(), store.recent()]);
  return { snapshot: stored?.snapshot ?? null, receivedAt: stored?.receivedAt ?? null, pending, recent };
}

export async function hostedCommand(store: LinkStore, keys: LinkKeys, verb: Verb, nowSec: number) {
  const command = buildCommand({ verb, channel: "remote", installId: keys.installId, cmdKeyHex: keys.cmdKey, nowSec });
  await store.enqueue(command);
  return { id: command.id, ok: true as const, message: "queued; the Mac applies it on its next pull (≤ 15 s)", queued: true as const };
}
