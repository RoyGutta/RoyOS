import { childEnv } from "@/lib/jarvis/runs";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { BUSINESS_DIR, readStore } from "@/lib/business/store";
import type { ContentItem, ContentPayload, Report } from "@/lib/content/types";

export const dynamic = "force-dynamic";

import { VOICE_LINE } from "@/lib/jarvis/runs";   // one authoritative checkout (~/Developer/Jarvis), never the iCloud copy
type Live = { platforms: Report["platforms"]; launch: Report["launch"] };
let liveCache: { at: number; value: Live } | null = null;

/** Live platform + launch-readiness truth from content_os.py (token metadata only, never tokens), cached 20 s so polling stays cheap. */
function liveState(): Promise<Live | null> {
  if (liveCache && Date.now() - liveCache.at < 20_000) return Promise.resolve(liveCache.value);
  return new Promise((resolve) => {
    const env = childEnv();
    execFile("uv", ["run", "python", "content_os.py", "live"], { cwd: VOICE_LINE, env, timeout: 30_000 }, (_err, stdout) => {
      try {
        const start = stdout.indexOf("{");
        const parsed = JSON.parse(stdout.slice(start)) as Live;
        liveCache = { at: Date.now(), value: parsed };
        resolve(parsed);
      } catch { resolve(null); }
    });
  });
}

/** GET /api/content — items + the derived experiment report written by content_os.py, with live platform states. */
export async function GET() {
  const { store, exists } = await readStore();
  let report: Report | null = null;
  try { report = JSON.parse(await fs.readFile(path.join(BUSINESS_DIR, "content_report.json"), "utf-8")) as Report; } catch { report = null; }
  const live = await liveState();
  if (report && live) report = { ...report, platforms: live.platforms, launch: live.launch };
  const items = (store.content as unknown as ContentItem[]).filter((c) => c && typeof c === "object");
  const audit = store.audit.filter((a) => a.action.startsWith("content_")).slice(-40);
  const body: ContentPayload = { exists, items, report, audit };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
