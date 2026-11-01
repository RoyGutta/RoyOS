import Assistant from "@/components/Assistant";

/** Home: the Jarvis assistant page (voice + text, one runtime). The card-based command center lives at /command. */
export default function Page() {
  return (
    <main className="p-3 sm:p-5 pt-3 max-w-[1500px] mx-auto">
      <Assistant />
    </main>
  );
}
