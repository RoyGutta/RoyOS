import { NextResponse } from "next/server";
import { readStore } from "@/lib/business/store";
import { LEAD_VIEWS, leadCounts, leadView, priority, type LeadRecord, type LeadView } from "@/lib/business/leads";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/leads?view=&synthetic=1&id= — leads with their evidence, score and priority (read-only). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const { store, exists } = await readStore();
  const leads = store.leads as LeadRecord[];
  const synthetic = u.searchParams.get("synthetic") === "1";
  const id = u.searchParams.get("id");
  const withPriority = (l: LeadRecord) => ({ ...l, priority: priority(l) });
  if (id) {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return NextResponse.json({ error: "no such lead" }, { status: 404 });
    const docs = store.documents.filter((d) => d.linkedId === id);
    const client = store.clients.find((c) => c.id === lead.clientId) ?? null;
    const project = store.projects.find((p) => p.id === lead.projectId) ?? null;
    const tasks = project ? store.tasks.filter((t) => t.projectId === project.id) : [];
    return NextResponse.json({ lead: withPriority(lead), documents: docs, client, project, tasks }, { headers: { "Cache-Control": "no-store" } });
  }
  const view = (LEAD_VIEWS as readonly string[]).includes(u.searchParams.get("view") ?? "") ? (u.searchParams.get("view") as LeadView) : "all";
  return NextResponse.json(
    { exists, view, counts: leadCounts(leads, synthetic), syntheticCount: leads.length - leadCounts(leads, false).all, leads: leadView(leads, view, synthetic).map(withPriority) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
