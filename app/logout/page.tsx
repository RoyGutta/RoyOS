import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default function LogoutPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[480px] mx-auto flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head"><span className="eyebrow">Jarvis · sign out</span></div>
        <div className="px-4 py-4 flex flex-col gap-3 text-[13px]">
          <p className="text-dim">Signing out deletes this session on the server; the Mac keeps running whatever state it is in.</p>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
