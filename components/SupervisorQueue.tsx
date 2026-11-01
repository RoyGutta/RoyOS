"use client";

import { usePolling } from "./usePolling";

interface Payload {
  state: string; enabled: boolean; paused: boolean; stopped: boolean; nextCheckAt: number | null;
  lastRun: { runId: string; model: string; actualModel: string | null; effort: string; outcome: string; objective: string | null; handoffValid: boolean } | null;
  queue: { tree: string; files: string[]; critical: string[] }[];
  notPatched: { withheld: string[]; symlinks: string[]; hardlinks: string[]; excluded: string[]; binary: string[] } | null;
  patchDir: string | null;
}

/** The supervisor's pending patch, by file name. Nothing is ever applied from here: review in a terminal, then `patch -p1`. */
export default function SupervisorQueue() {
  const { data, error } = usePolling<Payload>("/api/supervisor", 10000);
  if (error) return <div className="text-offline text-[12px] p-4">supervisor status failed: {error}</div>;
  if (!data) return null;
  const total = data.queue.reduce((n, q) => n + q.files.length, 0);
  const crit = data.queue.flatMap((q) => q.critical.map((f) => `${q.tree}/${f}`));
  const np = data.notPatched;
  return (
    <section className="panel flex flex-col">
      <div className="panel__head"><span className="eyebrow">Supervisor · patch queue</span>
        <span className="text-muted text-[11px]">{data.state}{data.enabled ? " · started" : " · not started"}{data.paused ? " · paused" : ""}{data.stopped ? " · stopped" : ""}</span></div>
      <div className="px-4 py-3 text-[13px] flex flex-col gap-2">
        {data.lastRun && <div className="text-muted text-[12px]">Last run {data.lastRun.runId}: {data.lastRun.outcome} · requested {data.lastRun.model} ({data.lastRun.effort}), ran {data.lastRun.actualModel ?? "?"} · handoff {data.lastRun.handoffValid ? "valid" : "missing"}{data.lastRun.objective ? ` · ${data.lastRun.objective.slice(0, 90)}` : ""}</div>}
        {total === 0 ? <div className="text-muted">No pending changes.</div> : (
          <>
            <div><span className="text-ink">{total} file(s) waiting for review</span>{crit.length > 0 && <span className="badge badge--bad ml-2">{crit.length} security-critical: read in full</span>}</div>
            <ul className="text-[12px] tabular-nums">{data.queue.flatMap((q) => q.files.map((f) => <li key={`${q.tree}/${f}`} className={q.critical.includes(f) ? "text-offline" : ""}>{q.tree}/{f}</li>))}</ul>
          </>
        )}
        {np && (np.withheld.length + np.symlinks.length + np.hardlinks.length + np.excluded.length + np.binary.length) > 0 &&
          <div className="text-muted text-[11px]">Not in the patch (names only): {[...np.withheld.map((x) => `${x} (secret-looking)`), ...np.symlinks.map((x) => `${x} (symlink)`), ...np.hardlinks.map((x) => `${x} (hardlink)`), ...np.excluded.map((x) => `${x} (excluded)`), ...np.binary.map((x) => `${x} (binary)`)].join(", ")}</div>}
        <div className="text-muted text-[10.5px]">Never applied automatically. Review: <code>less &quot;{data.patchDir ?? "~/Library/Application Support/Jarvis/supervisor/patches"}/latest-jarvis.patch&quot;</code>, then apply by hand with <code>patch -p1</code> and run <code>supervisor.py sync</code>.</div>
      </div>
    </section>
  );
}
