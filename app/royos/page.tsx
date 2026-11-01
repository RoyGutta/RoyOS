import SystemStatus from "@/components/SystemStatus";
import TaskFeed from "@/components/TaskFeed";
import ModelStatus from "@/components/ModelStatus";
import MemoryPanel from "@/components/MemoryPanel";
import FileTree from "@/components/FileTree";
import { VAULT, VAULT_BLOCKED, VAULT_BLOCKED_REASON } from "@/lib/config";

/**
 * The original RoyOS runtime view (read-only over the vault configured in
 * lib/config.ts). Moved here unchanged when the Jarvis command center became
 * the home page on 2026-10-11.
 */
export default function RoyOSPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1400px] mx-auto flex flex-col gap-4">
      {VAULT_BLOCKED && (
        <section className="panel px-4 py-3 border-offline/60" role="alert">
          <div className="eyebrow text-offline mb-1">RoyOS vault view unavailable — unauthorised</div>
          <div className="text-[13px] text-ink">{VAULT_BLOCKED_REASON}</div>
          <div className="text-[11px] text-muted mt-1">Configured vault: {VAULT}. The panels below show empty states; nothing is read from that location.</div>
        </section>
      )}
      <SystemStatus />
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4">
        <div className="h-[560px] min-h-0">
          <TaskFeed />
        </div>
        <div className="grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 h-[560px] min-h-0">
          <ModelStatus />
          <MemoryPanel />
        </div>
      </div>
      <FileTree />
      <footer className="text-muted text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2">
        <span>RoyOS runtime view</span>
        <span className="text-line2">·</span>
        <span>read-only view of the vault</span>
        <span className="text-line2">·</span>
        <span>polls local API routes — no cloud, no database</span>
      </footer>
    </main>
  );
}
