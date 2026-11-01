import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { JARVIS_DIR } from "@/lib/jarvis/runs";

/**
 * GET /api/workflows — READ-ONLY view of multi-step computer tasks (voice-line/workflow.py → logs/workflows.json) and
 * the last permission status the voice line measured from inside Terminal (logs/permissions.json). Typed text and file
 * contents are never stored by the workflow engine, so nothing private can be shown here.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const read = async (f: string) => { try { return JSON.parse(await fs.readFile(path.join(JARVIS_DIR, "logs", f), "utf-8")); } catch { return null; } };
  const corrupt = await fs.stat(path.join(JARVIS_DIR, "logs", "workflows.json.CORRUPT")).then(() => true).catch(() => false);
  const wf = await read("workflows.json");
  const workflows = Array.isArray(wf?.workflows) ? [...wf.workflows].reverse().slice(0, 20) : [];
  const permissions = await read("permissions.json");
  return NextResponse.json({ workflows, corrupt, permissions }, { headers: { "Cache-Control": "no-store" } });
}
