import AgentCenter from "@/components/AgentCenter";

export default function AgentsPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <AgentCenter />
      <footer className="text-muted text-[11px] px-1 pb-2">Agents · one coordinator (the Jarvis you talk to) and four scoped specialists sharing one ledger (voice-line/agents.py, scheduler.py, runs.py) · at most two workers run at once · a worker never approves its own consequential action</footer>
    </main>
  );
}
