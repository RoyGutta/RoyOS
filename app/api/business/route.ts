import { NextResponse } from "next/server";
import { INTEGRATIONS, readStore, summary } from "@/lib/business/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/business — the whole Business OS view (read-only; Jarvis's tools write). */
export async function GET() {
  const { store, exists } = await readStore();
  return NextResponse.json(
    { exists, summary: summary(store), integrations: INTEGRATIONS,
      leads: store.leads, clients: store.clients, projects: store.projects, tasks: store.tasks,
      documents: store.documents, content: store.content, revenue: store.revenue, audit: store.audit.slice(-30) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
