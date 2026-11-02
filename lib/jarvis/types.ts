/** Run ledger types and constants, free of Node imports so client components can use them. */
export const RUN_STATES = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;
export type RunState = (typeof RUN_STATES)[number];
export const RUN_SOURCES = ["voice", "typed", "dashboard", "scripted", "system"] as const;

export interface RunTool { id: string; name: string; summary: string; ok: boolean | null; startedAt: string; endedAt: string | null }
export interface Run {
  id: string; createdAt: string; startedAt: string; endedAt: string | null;
  state: RunState; source: string; request: string; reply: string | null; detail: string;
  tools: RunTool[]; toolCalls: number; toolFailures: number;
  approval: { id: string; description: string; resolved: "approved" | "declined" | null } | null;
  error: string | null;
  verification: { evidence: "tools" | "none"; toolFailures: number };
}

/** Delegated task (a run with kind="task"); see voice-line/runs.py and agents.py. */
export interface Task extends Omit<Run, "approval" | "verification"> {
  kind: "task"; parentId: string | null; agent: string; assignedBy: string; title: string; acceptance: string;
  deps: string[]; claims: string[]; inputs: string[]; lease: { agent: string; pid: number; startedAt: string; heartbeatAt: number } | null;
  handoff: { status: string; requested: string; completed: string; filesChanged: string[]; testsRun: string[]; testsEstablished: string; remaining: string; decisionsNeeded: string[]; nextTask: string; artifacts: string[] } | null;
  artifacts: string[]; verification: { by: string; status: string; notes: string; evidence?: string; toolFailures?: number };
  cancelRequested: boolean; retries: number; maxRetries: number; depth: number; events: { at: string; what: string }[];
  approval: { id: string; description: string; granted?: boolean; tool?: string; resolved?: "approved" | "declined" | null } | null;
}
/**
 * The voice line's pending approval (.voice_status.json pending_approval), as the dashboard shows it. `fullText` is the
 * complete message when it does not fit in the description (read it before approving). OB-10: for the outbound review
 * card (tool outbound_review = step 1 of 2, outbound_send = step 2 of 2) the runtime leaves fullText UNMASKED — the full
 * recipient (name and address or number) and the exact text — and lib/jarvis/redact.ts keeps that exception to that one
 * card on Roy's local dashboard; it never reaches events, audit or logs.
 */
export interface PendingApproval {
  id?: string; tool: string; description: string;
  category?: string; action?: string; target?: string; effect?: string; cost?: string; reversible?: boolean | null;
  fullText?: string;
}
export interface AgentInfo {
  id: string; name: string; responsibility: string; writeRoots: string[]; tools: string[]; bash: string; configVersion: string;
  sessionId: string | null; sessionAt: number; status: string; currentTaskId: string | null; parentRunId: string | null;
  lastActivity: string | null; recent: { task: string; state: string; at: string; title: string }[];
  catalogStatus?: string; dispatchable?: boolean; skills?: string[]; connectors?: string[];
}
/** Dispatchable roles (catalog.py, version 2026-10-12.1). Planned/routine/coordinator roles are not enqueueable. */
export const AGENT_IDS = ["core", "research", "reviewer", "security", "accessibility", "business", "tidefable", "design", "planner"] as const;
