import RunsCenter from "@/components/RunsCenter";

export default function RunsPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <RunsCenter />
      <footer className="text-muted text-[11px] px-1 pb-2">Runs · one record per request the Jarvis runtime handled (voice-line/runs.py) · states come from real events, never from timers</footer>
    </main>
  );
}
