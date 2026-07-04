"use client";

import { usePolling, timeAgo } from "./usePolling";
import type { StatePayload, ModelsPayload, LogsPayload } from "@/lib/types";

function Tile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5 border-l border-line flex flex-col justify-center min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-ink text-[13px] truncate">{children}</div>
    </div>
  );
}

export default function SystemStatus() {
  const state = usePolling<StatePayload>("/api/state", 2000);
  const models = usePolling<ModelsPayload>("/api/models", 4000);
  const logs = usePolling<LogsPayload>("/api/logs", 3000);

  const running = state.data?.running ?? false;
  const dotClass = running
    ? "dot dot--online dot--live"
    : state.data?.lastRun
      ? "dot dot--offline"
      : "dot dot--offline";

  const statusLabel = running
    ? "RUNNING"
    : state.data?.lastRun
      ? "IDLE / STOPPED"
      : "NO SIGNAL";
  const statusColor = running ? "text-online" : "text-offline";

  return (
    <header className="panel overflow-hidden">
      <div className="flex flex-wrap items-stretch">
        {/* wordmark */}
        <div className="px-5 py-3 flex items-center gap-3 flex-1 min-w-[220px]">
          <span className={dotClass} aria-hidden />
          <div className="leading-none">
            <div className="text-[17px] tracking-[0.14em] text-ink">
              ROY<span className="text-accent">//</span>OS
            </div>
            <div className="eyebrow mt-1">Autonomous · Local · Control Center</div>
          </div>
        </div>

        {/* live tiles */}
        <div className="flex flex-wrap">
          <Tile label="Loop">
            <span className={statusColor}>{statusLabel}</span>
          </Tile>
          <Tile label="Last Cycle">
            {timeAgo(state.data?.lastRun)}
            {state.data?.secondsSinceLastRun != null && (
              <span className="text-muted"> · {state.data.secondsSinceLastRun}s</span>
            )}
          </Tile>
          <Tile label="Active Model">
            {models.data?.ollamaUp ? (
              <span className="text-accent">{models.data.active ?? "idle"}</span>
            ) : (
              <span className="text-muted">ollama down</span>
            )}
          </Tile>
          <Tile label="Tasks Logged">
            {logs.data?.count ?? "—"}
          </Tile>
          <Tile label="Files Seen">
            {state.data?.seenCount ?? "—"}
          </Tile>
        </div>
      </div>
      <div className={`carrier ${running ? "carrier--live" : ""}`} />
    </header>
  );
}
