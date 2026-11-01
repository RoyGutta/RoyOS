import ContentOS from "@/components/ContentOS";
import JarvisPanel from "@/components/JarvisPanel";

export default function ContentPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <ContentOS />
      <div className="h-[360px] min-h-0"><JarvisPanel /></div>
      <footer className="text-muted text-[11px] px-1 pb-2">
        Tidefable Content OS · nothing publishes without the Approve button · platforms show CONNECTED only after a verified live call · <a className="text-accent" href="/business">Business OS</a> · <a className="text-accent" href="/">Command Center</a>
      </footer>
    </main>
  );
}
