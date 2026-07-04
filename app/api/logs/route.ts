import { NextResponse } from "next/server";
import { FILES } from "@/lib/config";
import { readTextSafe } from "@/lib/fs";
import { parseLogs } from "@/lib/parser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/logs — execution-log.jsonl (live) merged with execution-log.md (mirror),
// parsed into structured, newest-first task events.
export async function GET() {
  const [jsonl, md] = await Promise.all([
    readTextSafe(FILES.logJsonl),
    readTextSafe(FILES.logMd),
  ]);
  const payload = parseLogs(jsonl, md);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
