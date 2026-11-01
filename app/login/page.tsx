import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { isHosted } from "@/lib/continuous/mode";
import { pageSession } from "@/lib/continuous/serverSession";

export const dynamic = "force-dynamic";

/** Sign in: passphrase (both modes) plus a 6-digit authenticator code when hosted. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const auth = await pageSession();
  if (auth.ok) redirect("/continuous");
  const sp = await searchParams;
  const next = typeof sp.next === "string" && /^\/(continuous|system|logout)$/.test(sp.next) ? sp.next : "/continuous";
  const problem = auth.reason === "config" || auth.reason === "store" ? auth.message : null;
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[480px] mx-auto flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head"><span className="eyebrow">Jarvis · sign in</span><span className="text-muted text-[11px]">{isHosted() ? "hosted" : "local"}</span></div>
        <div className="px-4 py-4">
          <LoginForm hosted={isHosted()} next={next} problem={problem} />
        </div>
      </section>
    </main>
  );
}
