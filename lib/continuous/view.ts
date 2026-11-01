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
