import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import { PREVIEW_MAX_BYTES } from "@/lib/config";
import { resolveInVault } from "@/lib/fs";
import type { FilePayload } from "@/lib/types";

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
  const buf = await fsp.readFile(abs);
  const slice = truncated ? buf.subarray(0, PREVIEW_MAX_BYTES) : buf;
  // If a null byte slipped through an unknown extension, treat as binary.
  const hasNull = slice.includes(0);

  const payload: FilePayload = {
    path: rel,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    binary: hasNull,
    truncated,
    content: hasNull ? "" : slice.toString("utf-8"),
  };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
