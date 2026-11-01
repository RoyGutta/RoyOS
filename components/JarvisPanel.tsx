"use client";

import { usePolling } from "./usePolling";
import type { JarvisPayload } from "@/app/api/jarvis/route";

const LABEL: Record<string, string> = {
  OFFLINE: "OFFLINE",
  IDLE: "IDLE",
  LISTENING: "LISTENING",
  TRANSCRIBING: "TRANSCRIBING",
  THINKING: "THINKING",
  TOOL_EXECUTION: "WORKING",
  WAITING_FOR_APPROVAL: "NEEDS APPROVAL",
  SPEAKING: "SPEAKING",
  BACKGROUND_WORK: "BACKGROUND",
  ERROR: "ERROR",
};

function clock(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Jarvis — the voice front end. Reads the voice line's state machine and
 * user-facing event stream (read-only). Brain: Claude via Roy's subscription;
 * RoyOS is the durable worker behind it; no local model runs in this loop.
 */
export default function JarvisPanel() {
  const { data } = usePolling<JarvisPayload>("/api/jarvis", 1500);
  const running = data?.running ?? false;
  const state = data?.state ?? "OFFLINE";
  const live = running && state !== "IDLE";
  const dot = !running ? "dot dot--offline" : live ? "dot dot--active dot--live" : "dot dot--online";
  const stateColor = !running ? "text-offline" : state === "ERROR" ? "text-offline" : "text-online";

  return (
    <section className="panel flex flex-col min-h-0 h-full">
      <div className="panel__head">
        <span className={dot} aria-hidden />
        <span className="eyebrow">Jarvis</span>
        <span className="text-muted text-[11px]">voice front end · brain: Claude (subscription) · local model: none</span>
        <span className={`ml-auto chip ${stateColor}`}>{LABEL[state] ?? state}</span>
      </div>

      <div className="px-4 py-3 border-b border-line grid grid-cols-3 gap-3">
        <div>
          <div className="eyebrow mb-1">Activity</div>
          <div className="text-ink text-[13px] truncate">
            {data?.detail || (running ? "—" : "voice line not running")}
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1">RoyOS jobs from Jarvis</div>
          <div className="text-ink text-[13px]">{data?.backgroundJobs ?? 0} running</div>
        </div>
        <div>
          <div className="eyebrow mb-1">Approval</div>
          <div className={`text-[13px] truncate ${data?.pendingApproval ? "text-offline" : "text-muted"}`}>
            {data?.pendingApproval ? data.pendingApproval.description : "nothing pending"}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-line space-y-2">
        <div>
          <div className="eyebrow mb-1">You</div>
          <div className="text-ink text-[13px] line-clamp-2">{data?.lastYou ?? "—"}</div>
        </div>
        <div>
          <div className="eyebrow mb-1">Jarvis</div>
          <div className="text-ink text-[13px] line-clamp-4">{data?.lastJarvis ?? "—"}</div>
        </div>
      </div>

      <div className="px-4 py-3 min-h-0 overflow-auto flex-1">
        <div className="eyebrow mb-1.5">Recent actions</div>
        {data && data.actions.length > 0 ? (
          <ul className="space-y-1">
            {[...data.actions].reverse().map((a, i) => (
              <li key={`${a.ts}-${i}`} className="flex gap-3 text-[12px]">
                <span className="text-muted tabular-nums shrink-0">{clock(a.ts)}</span>
                <span className="text-ink truncate">{a.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted text-[12px]">no actions this session</div>
        )}
      </div>
    </section>
  );
}
