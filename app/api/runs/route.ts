import { NextResponse } from "next/server";
import { readRuns, runSummary, RUN_STATES, ledgerState } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/runs?state=&source=&q=&limit=&id= — read-only view of the run ledger. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const all = await readRuns();
  const id = u.searchParams.get("id");
  if (id) {
    const run = all.find((r) => r.id === id) ?? null;
    return NextResponse.json({ run }, { status: run ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  }
  const state = u.searchParams.get("state") ?? "";
  const source = u.searchParams.get("source") ?? "";
  const q = (u.searchParams.get("q") ?? "").toLowerCase();
  const limit = Math.max(1, Math.min(300, Number(u.searchParams.get("limit") ?? 50) || 50));
  let runs = all;
  if (state && (RUN_STATES as readonly string[]).includes(state)) runs = runs.filter((r) => r.state === state);
  if (source) runs = runs.filter((r) => r.source === source);
  if (q) runs = runs.filter((r) => r.request.toLowerCase().includes(q) || (r.reply ?? "").toLowerCase().includes(q));
  return NextResponse.json({ summary: runSummary(all), runs: runs.slice(0, limit), ledger: await ledgerState() }, { headers: { "Cache-Control": "no-store" } });
}
