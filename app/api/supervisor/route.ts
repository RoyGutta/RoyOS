import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { JARVIS_DIR } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Patch = { patches?: Record<string, { path: string; files: string[]; critical: string[] }>; files?: number; withheld?: string[]; symlinks?: string[]; hardlinks?: string[]; excluded?: string[]; binary?: string[]; dir?: string };

/** GET /api/supervisor — the supervisor's state and its patch queue, read from logs/supervisor/{state,control}.json.
 *  File NAMES only: patch contents are never read here (they are reviewed in a terminal and applied by hand). */
export async function GET() {
  const dir = path.join(JARVIS_DIR, "logs", "supervisor");
  const read = async (f: string) => { try { return JSON.parse(await fs.readFile(path.join(dir, f), "utf-8")); } catch { return null; } };
  const [state, control] = await Promise.all([read("state.json"), read("control.json")]);
  const last = state?.lastRun ?? null;
  const patch: Patch | null = last?.patch ?? null;
  return NextResponse.json({
    state: state?.state ?? "not installed", since: state?.since ?? null, enabled: Boolean(control?.enabled), paused: Boolean(control?.paused || state?.paused),
    stopped: Boolean(control?.stopped), nextCheckAt: state?.nextCheckAt ?? null, runsToday: state?.runsToday ?? null,
    lastRun: last ? { runId: last.runId, model: last.model, actualModel: last.init?.model ?? null, effort: last.effort, outcome: last.outcome, objective: last.objective, handoffValid: last.handoffValid } : null,
    queue: patch?.patches ? Object.entries(patch.patches).map(([tree, p]) => ({ tree, files: p.files, critical: p.critical })) : [],
    notPatched: patch ? { withheld: patch.withheld ?? [], symlinks: patch.symlinks ?? [], hardlinks: patch.hardlinks ?? [], excluded: patch.excluded ?? [], binary: patch.binary ?? [] } : null,
    patchDir: patch?.dir ?? null,
  });
}
