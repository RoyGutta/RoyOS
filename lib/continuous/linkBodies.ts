/**
 * Relay request bodies (contract v1.1 §Relay API), parsed strictly (DC-9): a body is a JSON object whose every own key
 * is declared — checked with `Object.hasOwn` against a null-prototype allow-list, so an unknown key, an inherited name
 * or `__proto__` is refused rather than ignored. Pure module, unit-tested without Next.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACK_KEYS: Record<string, true> = Object.assign(Object.create(null) as Record<string, true>, { id: true, ok: true, message: true });

export interface AckBody { id: string; ok: boolean; message: string | null }
export type Parsed<T> = { ok: true; body: T } | { ok: false; error: string };

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** `{id, ok, message?}` — id a uuid v4, ok a boolean, message absent, null or plain text ≤ 120 characters. Nothing else. */
export function parseAckBody(value: unknown): Parsed<AckBody> {
  const b = plainObject(value);
  if (!b) return { ok: false, error: "body must be a JSON object" };
  for (const k of Object.keys(b)) if (!Object.hasOwn(ACK_KEYS, k)) return { ok: false, error: `${k} is not part of an ack` };
  if (typeof b.id !== "string" || !UUID_V4.test(b.id)) return { ok: false, error: "id must be a uuid v4" };
  if (typeof b.ok !== "boolean") return { ok: false, error: "ok must be a boolean" };
  const message = Object.hasOwn(b, "message") ? b.message : null;
  if (message !== null && (typeof message !== "string" || message.length > 120)) return { ok: false, error: "message must be ≤ 120 characters" };
  return { ok: true, body: { id: b.id, ok: b.ok, message } };
}

/** The commands pull carries `{}` and nothing else. */
export function parseCommandsBody(value: unknown): Parsed<Record<string, never>> {
  const b = plainObject(value);
  if (!b) return { ok: false, error: "body must be a JSON object" };
  const extra = Object.keys(b);
  if (extra.length) return { ok: false, error: `${extra[0]} is not part of a commands pull (body must be {})` };
  return { ok: true, body: {} };
}
