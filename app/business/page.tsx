import BusinessOS from "@/components/BusinessOS";
import JarvisPanel from "@/components/JarvisPanel";

export default function BusinessPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1400px] mx-auto flex flex-col gap-4">
      <BusinessOS />
      <div className="h-[360px] min-h-0"><JarvisPanel /></div>
      <footer className="text-muted text-[11px] px-1 pb-2">
        Business OS · local-first · every number is entered data or a connected service; nothing is sent, published or charged by Jarvis without your approval · <a className="text-accent" href="/">Command Center</a> · <a className="text-accent" href="/leads">Leads</a>
      </footer>
    </main>
  );
}
