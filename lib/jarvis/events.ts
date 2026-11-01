/**
 * The typed event contract between the voice line (voice-line/events.py writes
 * .voice_events.jsonl) and the dashboard. Pure, Node-free: client components
 * may import it. The file resets at each voice-line session, so a transcript
 * built here is "this session"; history lives in the run ledger (/runs).
 *
 * Ordering: `seq` is monotonic within a session. A turn is opened by
 * transcript.final and closed by run.finished. Events that carry a runId are
 * applied to the turn with that runId (so an older run's late close can never
 * mark a newer turn); events without one go to the open (last) turn.
 */

export type JarvisState =
  | "IDLE" | "LISTENING" | "TRANSCRIBING" | "THINKING" | "TOOL_EXECUTION"
  | "WAITING_FOR_APPROVAL" | "SPEAKING" | "BACKGROUND_WORK" | "ERROR" | "OFFLINE";

export type RunState = "QUEUED" | "RUNNING" | "WAITING_FOR_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

interface Base { seq: number; ts: number }
export type JarvisEvent =
  | (Base & { type: "session.started" }) | (Base & { type: "session.stopped" })
  | (Base & { type: "session.connected"; seconds: number; resumed: boolean }) | (Base & { type: "session.resumed"; session_id: string })
  | (Base & { type: "speech.started" }) | (Base & { type: "speech.stopped"; seconds: number })
  | (Base & { type: "transcript.partial"; text: string }) | (Base & { type: "transcript.final"; text: string; typed?: boolean; source?: string; seconds?: number })
  | (Base & { type: "run.started"; runId: string; source: string; request: string })
  | (Base & { type: "run.finished"; runId: string | null; state: RunState; error: string | null })
  | (Base & { type: "model.started" }) | (Base & { type: "model.delta"; text: string }) | (Base & { type: "model.completed"; ok: boolean; chars?: number; interrupted?: boolean })
  | (Base & { type: "tool.started"; tool: string; summary: string; id: string }) | (Base & { type: "tool.completed"; tool: string; ok: boolean; id: string })
  | (Base & { type: "approval.requested"; tool: string; description: string; id: string }) | (Base & { type: "approval.resolved"; approved: boolean; action: string; id?: string })
  | (Base & { type: "tts.started"; source: string; seconds_since_turn?: number }) | (Base & { type: "tts.completed"; seconds?: number; interrupted?: boolean })
  | (Base & { type: "job.started"; job_id: string }) | (Base & { type: "job.completed"; job_id: string; ok: boolean; state?: string })
  | (Base & { type: "task.updated"; taskId: string; agent: string; state: string; detail: string; parentId: string | null; title: string })
  | (Base & { type: "agent.selected"; agent: string; taskId: string; reason: string })
  | (Base & { type: "routine.started"; routine: string; by: string }) | (Base & { type: "routine.completed"; routine: string; ok: boolean; error?: string | null })
  | (Base & { type: "action"; summary: string })
  | (Base & { type: "error"; where: string; message: string })
  | (Base & { type: string; [k: string]: unknown });

export interface TurnTool { id: string; name: string; summary: string; ok: boolean | null; ts: number }
export interface Turn {
  seq: number; ts: number; you: string; source: string; jarvis: string; runId: string | null;
  state: "open" | RunState; error: string | null; tools: TurnTool[]; approval: { id: string; description: string; resolved: boolean | null } | null;
  interrupted: boolean;
}

/** Fold the event stream into conversation turns (newest last). */
export function buildTurns(events: JarvisEvent[], max = 30): Turn[] {
  const turns: Turn[] = [];
  const open = () => turns[turns.length - 1] && turns[turns.length - 1].state === "open" ? turns[turns.length - 1] : null;
  for (const e of events) {
    if (e.type === "transcript.final") {
      // a yes/no that resolves an approval still opens a turn: the user said something
      turns.push({ seq: e.seq, ts: e.ts, you: String(e.text ?? ""), source: String(e.source ?? (e.typed ? "typed" : "voice")), jarvis: "", runId: null, state: "open", error: null, tools: [], approval: null, interrupted: false });
      continue;
    }
    // Events that carry a runId go to THAT run's turn (an older run's close can never land on a newer turn);
    // everything else goes to the open turn.
    const rid = typeof (e as { runId?: unknown }).runId === "string" ? String((e as { runId?: unknown }).runId) : null;
    const byRun = rid ? [...turns].reverse().find((x) => x.runId === rid) ?? null : null;
    const t = e.type === "run.started" ? open() : byRun ?? (rid ? null : open());
    if (!t) continue;
    switch (e.type) {
      case "run.started": t.runId = String(e.runId); break;
      case "model.delta": t.jarvis = String(e.text); break; // captions are cumulative (brain._caption_delta): latest wins
      case "model.completed": if (e.interrupted) t.interrupted = true; break;
      case "tool.started": t.tools.push({ id: String(e.id), name: String(e.tool), summary: String(e.summary ?? ""), ok: null, ts: e.ts }); break;
      case "tool.completed": { const x = t.tools.find((k) => k.id === String(e.id) && k.ok === null); if (x) x.ok = Boolean(e.ok); break; }
      case "approval.requested": t.approval = { id: String(e.id), description: String(e.description), resolved: null }; break;
      case "approval.resolved": if (t.approval) t.approval.resolved = Boolean(e.approved); break;
      case "tts.completed": if (e.interrupted) t.interrupted = true; break;
      case "error": if (["turn", "model", "transcribe"].includes(String(e.where))) t.error = String(e.message); break;
      case "run.finished": t.state = (e.state as RunState) ?? "COMPLETED"; if (e.error) t.error = String(e.error); break;
      default: break;
    }
  }
  return turns.slice(-max);
}

export interface ActivityLine { ts: number; kind: "action" | "approval" | "job" | "task" | "routine" | "agent"; summary: string }

/** The concise activity list (never chain-of-thought): actions, approvals, jobs, team tasks, routines. */
export function buildActivity(events: JarvisEvent[], max = 12): ActivityLine[] {
  const out: ActivityLine[] = [];
  for (const e of events) {
    if (e.type === "action") out.push({ ts: e.ts, kind: "action", summary: String(e.summary) });
    else if (e.type === "approval.resolved") out.push({ ts: e.ts, kind: "approval", summary: `${e.approved ? "Approved" : "Declined"}: ${String(e.action ?? "")}` });
    else if (e.type === "job.completed") out.push({ ts: e.ts, kind: "job", summary: `RoyOS job ${String(e.job_id ?? "").slice(0, 8)} ${e.ok ? "finished" : "failed"}` });
    else if (e.type === "task.updated" && ["RUNNING", "COMPLETED", "FAILED", "WAITING_FOR_APPROVAL", "CANCELLED", "TIMED_OUT", "BLOCKED"].includes(String(e.state)))
      out.push({ ts: e.ts, kind: "task", summary: `${String(e.agent)} · ${String(e.title || e.taskId)} → ${String(e.state).toLowerCase().replace(/_/g, " ")}` });
    else if (e.type === "agent.selected") out.push({ ts: e.ts, kind: "agent", summary: `Selected ${String(e.agent)}: ${String(e.reason)}` });
    else if (e.type === "routine.completed") out.push({ ts: e.ts, kind: "routine", summary: `${String(e.routine).replace(/_/g, " ")} ${e.ok ? "ready" : "failed"}` });
  }
  return out.slice(-max);
}

export const STATE_LABEL: Record<string, string> = {
  OFFLINE: "Offline", IDLE: "Ready", LISTENING: "Listening", TRANSCRIBING: "Transcribing", THINKING: "Thinking", TOOL_EXECUTION: "Running a tool",
  WAITING_FOR_APPROVAL: "Waiting for your approval", SPEAKING: "Speaking", BACKGROUND_WORK: "Background work", ERROR: "Error",
};
