import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import { PREVIEW_MAX_BYTES } from "@/lib/config";
import { resolveInVault } from "@/lib/fs";
import type { FilePayload } from "@/lib/types";
import { redact } from "@/lib/jarvis/redact";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar",
  "mp3", "mp4", "mov", "wav", "woff", "woff2", "ttf", "otf", "excalidraw",
]);

// GET /api/file?path=<vault-relative>  — READ-ONLY preview of a single file.
// Path traversal outside the vault is rejected by resolveInVault().
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path");
  if (!rel) {
    return NextResponse.json({ error: "Missing ?path" }, { status: 400 });
  }

  const abs = resolveInVault(rel);
  if (!abs) {
    return NextResponse.json({ error: "Path outside vault" }, { status: 403 });
  }
  if (rel.split(/[\\/]/).some((seg) => seg.startsWith(".")) || /\.env|\.secrets|\.voice_inbox|recipients\.local/i.test(rel)) {
    return NextResponse.json({ error: "Hidden and secret files are not previewed" }, { status: 403 });
  }
  // symlinks must not lead outside the vault either
  try {
    const real = await fsp.realpath(abs);
    const root = await fsp.realpath(resolveInVault("") ?? abs);
    if (real !== root && !real.startsWith(root + "/")) return NextResponse.json({ error: "Path outside vault" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (stat.isDirectory()) {
    return NextResponse.json({ error: "Is a directory" }, { status: 400 });
  }

  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const isBinary = BINARY_EXT.has(ext);

  if (isBinary) {
    const payload: FilePayload = {
      path: rel,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      binary: true,
      truncated: false,
      content: "",
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const truncated = stat.size > PREVIEW_MAX_BYTES;
  // read only the preview window, never the whole file
  const fh = await fsp.open(abs, "r");
  const slice = Buffer.alloc(Math.min(stat.size, PREVIEW_MAX_BYTES));
  try { await fh.read(slice, 0, slice.length, 0); } finally { await fh.close(); }
  // If a null byte slipped through an unknown extension, treat as binary.
  const hasNull = slice.includes(0);

  const payload: FilePayload = {
    path: rel,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    binary: hasNull,
    truncated,
    content: hasNull ? "" : redact(slice.toString("utf-8")),  // a pasted key inside a note never reaches the browser
  };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
