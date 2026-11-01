import { redirect } from "next/navigation";
import ContinuousMode from "@/components/ContinuousMode";
import { pageSession } from "@/lib/continuous/serverSession";

export const dynamic = "force-dynamic";

/** Continuous Mode: the Mac's supervisor, as the Mac last reported it, with on/off, pause, resume and stop. */
export default async function ContinuousPage() {
  const auth = await pageSession();
  if (!auth.ok) redirect("/login?next=%2Fcontinuous");
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1100px] mx-auto flex flex-col gap-4">
      <ContinuousMode />
      <footer className="text-muted text-[11px] px-1 pb-2">Continuous · every value here is the Mac&apos;s own report; the dashboard never decides state</footer>
    </main>
  );
}
