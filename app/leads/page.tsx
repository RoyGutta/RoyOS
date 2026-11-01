import LeadsWorkspace from "@/components/LeadsWorkspace";

export default function LeadsPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <LeadsWorkspace />
      <footer className="text-muted text-[11px] px-1 pb-2">
        Leads · evidence with its source URL · deterministic scoring (voice-line/leads.py) · no outreach is ever sent · a lead becomes a client only after you record the deal
      </footer>
    </main>
  );
}
