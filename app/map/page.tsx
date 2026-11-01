import ActivityMap from "@/components/ActivityMap";

export const metadata = { title: "Map — RoyOS Console" };

export default function MapPage() {
  return (
    <div className="min-h-screen p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <h1 className="sr-only">Activity map</h1>
      <ActivityMap />
    </div>
  );
}
