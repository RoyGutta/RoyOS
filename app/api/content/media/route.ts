import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

/** GET /api/content/media?id=cnt_x&kind=thumb|video — serves a rendered file for preview (local only). */
import { JARVIS_DIR, pinnedPath } from "@/lib/jarvis/runs";
const RENDERS = pinnedPath("JARVIS_RENDERS", path.join(JARVIS_DIR, "content/renders"));   // R13-1
const ID = /^cnt_[a-f0-9]{6,16}$/;
const KINDS: Record<string, { file: string; type: string }> = { thumb: { file: "thumb.png", type: "image/png" }, video: { file: "video.mp4", type: "video/mp4" } };

export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") ?? "";
  const kind = KINDS[u.searchParams.get("kind") ?? ""];
  if (!ID.test(id) || !kind) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const buf = await fs.readFile(path.join(RENDERS, id, kind.file));
    return new NextResponse(buf, { headers: { "Content-Type": kind.type, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not rendered" }, { status: 404 });
  }
}
