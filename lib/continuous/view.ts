import type { Snapshot } from "./snapshot";

/** Client-safe types and pure view helpers for the Continuous Mode panel. No secrets, no server imports. */
export interface StatusPayload {
  mode: "local" | "hosted";
  online: boolean;
  ageSec: number | null;
  receivedAt: string | null;
  snapshot: Snapshot | null;
  pending: { id: string; verb: string; issuedAt: number }[];
  recent: { id: string; verb: string; ok: boolean | null; message: string | null; ackedAt: string | null; status: string }[];
  installed: boolean;
  error: string | null;
  csrf: string;
  serverTime: string;
}

export type ToggleState = "on" | "off" | "unknown";

/** ON only when the Mac says so: enabled and not disabled/stopped. Anything stale or missing is UNKNOWN, never "running". */
export function toggleState(online: boolean, snapshot: Snapshot | null): ToggleState {
  if (!online || !snapshot) return "unknown";
  const s = snapshot.supervisor;
  if (!s.enabled || s.display === "disabled" || s.display === "stopped") return "off";
  return "on";
}

const REASONS: Record<string, string> = {
  roy_paused: "paused by Roy", roy_stopped: "stopped by Roy", limit: "usage limit reached", daily_cap: "daily run cap reached",
  conflict: "another session holds the workspace", needs_roy: "waiting for Roy", error: "the last run errored", none: "",
};

/** Hosted reasons are codes; the local snapshot may carry text. Both render as plain text. */
export function reasonText(reason: string | null | undefined): string {
  if (!reason) return "";
  return REASONS[reason] ?? reason;
}

export function displayLabel(display: string | undefined): string {
  return (display ?? "unknown").replace(/_/g, " ");
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtAge(sec: number | null): string {
  if (sec === null) return "never";
  if (sec < 60) return `${Math.round(sec)}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---- honest "last command" (DC-6) ------------------------------------------------------------------------------
/** What the browser knows right after it sent a command: the server's immediate answer, keyed by the command id. */
export interface SentCommand { id: string | null; verb: string; outcome: "queued" | "ok" | "refused" | "failed"; message: string; at: number }
export type LastState = "queued" | "ok" | "refused" | "expired" | "pending";
export interface LastView { verb: string; state: LastState; message: string; at: number | null }
export const QUEUED_TEXT = "queued — waiting for the Mac";

function fromRecent(r: StatusPayload["recent"][number]): LastView {
  const state: LastState = r.status === "expired" ? "expired" : r.ok === true ? "ok" : r.ok === false ? "refused" : "pending";
  return { verb: r.verb, state, message: r.message ?? "", at: r.ackedAt ? Date.parse(r.ackedAt) : null };
}

/**
 * A hosted command the server merely queued (202) is shown as queued — never as "ok" — until the Mac's ack for THAT
 * id appears in `recent`, and the Mac's answer (ok, refused, expired) then replaces the local record for good. A local
 * command (applied synchronously) shows its own result at once. With nothing sent this session, the newest result.
 */
export function lastCommandView(sent: SentCommand | null, status: Pick<StatusPayload, "pending" | "recent"> | null): LastView | null {
  if (sent) {
    const answered = sent.id ? status?.recent.find((r) => r.id === sent.id) : undefined;
    if (answered) return fromRecent(answered);
    if (sent.outcome === "queued") return { verb: sent.verb, state: "queued", message: QUEUED_TEXT, at: sent.at };
    return { verb: sent.verb, state: sent.outcome === "ok" ? "ok" : "refused", message: sent.message, at: sent.at };
  }
  return status?.recent[0] ? fromRecent(status.recent[0]) : null;
}

export function lastStateLabel(state: LastState): string {
  return state === "ok" ? "ok" : state === "refused" ? "refused" : state === "expired" ? "expired" : state === "queued" ? "queued" : "pending";
}
