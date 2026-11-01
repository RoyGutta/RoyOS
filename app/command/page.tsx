import CommandCenter from "@/components/CommandCenter";

/** The operational command center (cards: current task, attention, leads, business, system). The assistant page is at /. */
export default function Page() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <CommandCenter />
      <footer className="text-muted text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2">
        <span>Jarvis command center</span>
        <span className="text-line2">·</span>
        <span>one runtime for voice and text · nothing is sent, published or charged without your approval</span>
        <span className="text-line2">·</span>
        <span>local files only</span>
      </footer>
    </main>
  );
}
