import SystemStatus from "@/components/SystemStatus";
import TaskFeed from "@/components/TaskFeed";
import ModelStatus from "@/components/ModelStatus";
import MemoryPanel from "@/components/MemoryPanel";
import FileTree from "@/components/FileTree";

export default function Page() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1400px] mx-auto flex flex-col gap-4">
      <SystemStatus />

      {/* live activity row: execution feed (main) + model & memory (rail) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4">
        <div className="h-[560px] min-h-0">
          <TaskFeed />
        </div>
        <div className="grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 h-[560px] min-h-0">
          <ModelStatus />
          <MemoryPanel />
        </div>
      </div>

      {/* full-width vault explorer */}
      <FileTree />

      <footer className="text-muted text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2">
        <span>RoyOS Control Center</span>
        <span className="text-line2">·</span>
        <span>read-only view of the vault</span>
        <span className="text-line2">·</span>
        <span>polls local API routes — no cloud, no database</span>
      </footer>
    </main>
  );
}
