import SystemHealth from "@/components/SystemHealth";
import DisplayMap from "@/components/DisplayMap";
import SupervisorQueue from "@/components/SupervisorQueue";
import ContinuousMode from "@/components/ContinuousMode";

export default function SystemPage() {
  return (
    <main className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <SystemHealth />
      <DisplayMap />
      <ContinuousMode embedded />
      <SupervisorQueue />
      <footer className="text-muted text-[11px] px-1 pb-2">System · every state here comes from a live probe or a file check, never from configuration alone</footer>
    </main>
  );
}
