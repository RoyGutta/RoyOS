import { NextResponse } from "next/server";
import { FILES } from "@/lib/config";
import { readJsonSafe, readTextSafe } from "@/lib/fs";
import { parseMemory } from "@/lib/parser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/memory — memory.json (+ memory.md fallback) parsed into insights.
export async function GET() {
  const [json, md] = await Promise.all([
    readJsonSafe<{ log?: unknown }>(FILES.memoryJson, { log: [] }),
    readTextSafe(FILES.memoryMd),
  ]);
  const payload = parseMemory(json, md);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
