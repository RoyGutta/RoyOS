import { NextResponse } from "next/server";
import { FILES, HEARTBEAT_SECONDS } from "@/lib/config";
import { readJsonSafe } from "@/lib/fs";
import { buildStatePayload } from "@/lib/parser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/state — parsed state.json + derived heartbeat / running status.
export async function GET() {
  const raw = await readJsonSafe<{ seen?: unknown; lastRun?: unknown }>(
    FILES.state,
    {},
  );
  const payload = buildStatePayload(raw, HEARTBEAT_SECONDS);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
