import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { JARVIS_DIR } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/displays — Jarvis's last display inventory (logs/displays.json, written by display_ops on every display
 *  operation or by scripts/display_demo.py). Geometry and display names only: no window titles, no capture. The age is
 *  returned so the page never presents an old snapshot as live. */
export async function GET() {
  const file = path.join(JARVIS_DIR, "logs", "displays.json");
  try {
    const [text, st] = await Promise.all([fs.readFile(file, "utf-8"), fs.stat(file)]);
    return NextResponse.json({ snapshot: JSON.parse(text), ageSeconds: Math.round((Date.now() - st.mtimeMs) / 1000) });
  } catch {
    return NextResponse.json({ snapshot: null, ageSeconds: null });
  }
}
