import { NextResponse } from "next/server";
import { VAULT } from "@/lib/config";
import { buildTree } from "@/lib/fs";
import type { TreePayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/tree — recursive, bounded file tree of the vault (dirs first).
export async function GET() {
  const { root, fileCount, dirCount } = await buildTree();
  const payload: TreePayload = { root, fileCount, dirCount, vault: VAULT };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
