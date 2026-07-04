"use client";

import { usePolling, fmtBytes } from "./usePolling";
import type { ModelsPayload } from "@/lib/types";

// Mirrors the router in 08 AI/Agents/orchestrator.js → pickModel().
const ROUTES = [
  { when: "code · refactor · bug · fix", to: "qwen" },
  { when: "plan · design · architecture · improve", to: "llama" },
  { when: "default", to: "hermes" },
];

export default function ModelStatus() {
  const { data, loading } = usePolling<ModelsPayload>("/api/models", 4000);
  const up = data?.ollamaUp ?? false;
  const running = data?.running ?? [];
  const installed = data?.installed ?? [];
  const runningNames = new Set(running.map((m) => m.name));

  return (
    <section className="panel flex flex-col min-h-0 h-full">
      <div className="panel__head">
        <span
          className={`dot ${up ? "dot--online dot--live" : "dot--offline"}`}
          aria-hidden
        />
        <span className="eyebrow">Model Activity</span>
        <span className="text-muted text-[11px]">ollama · local inference</span>
        <span className={`ml-auto chip ${up ? "text-online" : "text-offline"}`}>
          {up ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      {/* active model */}
      <div className="px-4 py-3 border-b border-line">
        <div className="eyebrow mb-1.5">Loaded in memory</div>
        {up && running.length > 0 ? (
          <div className="space-y-1.5">
            {running.map((m) => (
              <div key={m.name} className="flex items-center gap-2">
                <span className="dot dot--online dot--live" aria-hidden />
                <span className="text-accent text-[13px]">{m.name}</span>
                <span className="text-muted text-[11px] ml-auto">
                  {m.parameterSize ?? ""}
                  {m.sizeBytes ? ` · ${fmtBytes(m.sizeBytes)}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted text-[12px]">
            {up
              ? "no model resident — agent is idle between cycles"
              : loading
                ? "probing ollama…"
                : "ollama unreachable — run `ollama serve`"}
          </div>
        )}
      </div>

      {/* router map */}
      <div className="px-4 py-3 border-b border-line">
        <div className="eyebrow mb-2">Router · by goal</div>
        <div className="space-y-1">
          {ROUTES.map((r) => (
            <div key={r.to} className="flex items-center gap-2 text-[11.5px]">
              <span className="text-dim flex-1 truncate">{r.when}</span>
              <span className="text-muted">→</span>
              <span
                className={
                  [...runningNames].some((n) => n.includes(r.to))
                    ? "text-accent"
                    : "text-dim"
                }
              >
                {r.to}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* installed */}
      <div className="px-4 py-3 flex-1 min-h-0 overflow-auto">
        <div className="eyebrow mb-2">Installed · {installed.length}</div>
        <div className="flex flex-wrap gap-1.5">
          {installed.map((m) => (
            <span
              key={m.name}
              className={`chip ${runningNames.has(m.name) ? "text-accent" : ""}`}
              title={m.sizeBytes ? fmtBytes(m.sizeBytes) : ""}
            >
              {runningNames.has(m.name) && (
                <span className="dot dot--online" aria-hidden />
              )}
              {m.name}
            </span>
          ))}
          {installed.length === 0 && (
            <span className="text-muted text-[12px]">
              {up ? "no models pulled" : "—"}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
