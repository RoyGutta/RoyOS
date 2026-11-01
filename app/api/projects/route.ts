import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { JARVIS_DIR } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";

/** GET /api/projects — the portfolio index (projects/index.json) plus each project's STATUS.md head and whether its docs exist. Read-only. */
export async function GET() {
  const root = path.join(JARVIS_DIR, "projects");
  let index: { version?: string; projects?: Record<string, unknown>[] } = {};
  try { index = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf-8")); } catch { return NextResponse.json({ projects: [], note: "no projects/index.json" }); }
  const projects = await Promise.all((index.projects ?? []).map(async (p) => {
    const dir = path.join(root, String(p.id));
    const docs: Record<string, boolean> = {};
    for (const d of ["README.md", "PRD.md", "ARCHITECTURE.md", "STATUS.md", "SECURITY.md", "TESTING.md", "DECISIONS.md"]) {
      try { await fs.access(path.join(dir, d)); docs[d] = true; } catch { docs[d] = false; }
    }
    let status = "";
    try { status = (await fs.readFile(path.join(dir, "STATUS.md"), "utf-8")).slice(0, 1200); } catch { /* none */ }
    return { ...p, dir: `projects/${String(p.id)}`, docs, statusHead: status };
  }));
  return NextResponse.json({ version: index.version, projects }, { headers: { "Cache-Control": "no-store" } });
}
