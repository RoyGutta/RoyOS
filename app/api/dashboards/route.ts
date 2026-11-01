import { childEnv } from "@/lib/jarvis/runs";
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { JARVIS_DIR, VOICE_LINE } from "@/lib/jarvis/runs";
import { localOriginGuard, inflightLock } from "@/lib/jarvis/guard";

export const dynamic = "force-dynamic";
const PROJECT = path.join(JARVIS_DIR, "projects", "spreadsheet-dashboard");
const OUTPUT = path.join(PROJECT, "output");
const UPLOADS = path.join(PROJECT, "uploads");
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_UPLOAD = 25 * 1024 * 1024;
const lock = inflightLock();

/**
 * GET  /api/dashboards            → the ingested datasets under projects/spreadsheet-dashboard/output (name, importedAt, rows, source)
 * GET  /api/dashboards?name=sales → one dataset's dashboard-data.json (profile, plan, rows ≤ 5,000, warnings)
 * POST /api/dashboards (multipart: file, name?) → saves the UNTRUSTED upload under uploads/, runs `python cli.py ingest`
 *      (stdlib readers: no macros, no formula evaluation), returns the dataset name. Nothing leaves the machine.
 */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (name) {
    if (!NAME.test(name)) return NextResponse.json({ error: "bad name" }, { status: 400 });
    try { return NextResponse.json(JSON.parse(await fs.readFile(path.join(OUTPUT, name, "dashboard-data.json"), "utf-8")), { headers: { "Cache-Control": "no-store" } }); }
    catch { return NextResponse.json({ error: "no such dataset" }, { status: 404 }); }
  }
  const out: { name: string; importedAt?: string; rows?: number; source?: string; warnings?: number }[] = [];
  try {
    for (const d of await fs.readdir(OUTPUT, { withFileTypes: true })) {
      if (!d.isDirectory() || !NAME.test(d.name)) continue;
      try {
        const j = JSON.parse(await fs.readFile(path.join(OUTPUT, d.name, "dashboard-data.json"), "utf-8")) as { importedAt?: string; profile?: { rowCount?: number; row_count?: number }; sourceFile?: string; warnings?: unknown[] };
        out.push({ name: d.name, importedAt: j.importedAt, rows: j.profile?.rowCount ?? j.profile?.row_count, source: j.sourceFile ? path.basename(j.sourceFile) : undefined, warnings: j.warnings?.length });
      } catch { out.push({ name: d.name }); }
    }
  } catch { /* no output dir yet */ }
  return NextResponse.json({ datasets: out, providers: { googleSheets: "authorization-pending", local: "local-functional" } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const refused = localOriginGuard(req);   // host, origin and sec-fetch-site: a cross-site multipart form is refused
  if (refused) return refused;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (!declared) return NextResponse.json({ ok: false, error: "Content-Length required (chunked uploads are refused)" }, { status: 411 });
  if (declared > MAX_UPLOAD + 4096) return NextResponse.json({ ok: false, error: "file larger than 25 MB" }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "multipart field `file` required" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ ok: false, error: "file larger than 25 MB" }, { status: 413 });
  const ext = path.extname(file.name).toLowerCase();
  if (![".csv", ".xlsx", ".tsv", ".txt"].includes(ext)) return NextResponse.json({ ok: false, error: "only .csv, .tsv, .txt or .xlsx (macro-enabled files are refused)" }, { status: 415 });
  const rawName = String(form?.get("name") ?? path.basename(file.name, ext)).replace(/[^a-z0-9._-]/gi, "-").slice(0, 48) || "dataset";
  const name = `${rawName}-${Date.now().toString(36)}`;
  if (!NAME.test(name)) return NextResponse.json({ ok: false, error: "bad name" }, { status: 400 });
  if (!lock.acquire()) return NextResponse.json({ ok: false, error: "an import is already running" }, { status: 409 });
  try {
    await fs.mkdir(UPLOADS, { recursive: true });
    const saved = path.join(UPLOADS, `${name}${ext}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    // the bytes must match the extension: xlsx is a zip (PK\x03\x04); text formats must not be a zip or contain NULs
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (ext === ".xlsx" && !isZip) return NextResponse.json({ ok: false, error: "not an xlsx file (bad signature)" }, { status: 415 });
    if (ext !== ".xlsx" && (isZip || bytes.subarray(0, 8192).includes(0))) return NextResponse.json({ ok: false, error: "text upload contains binary data" }, { status: 415 });
    await fs.writeFile(saved, bytes);
    const env = { ...childEnv(), PATH: `${os.homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` };  // allowlisted + JARVIS_NOT_FOREGROUND=1; no secrets reach the ingester
    const r = await new Promise<{ ok: boolean; out: string }>((resolve) => {
      execFile("uv", ["run", "--project", VOICE_LINE, "python", "cli.py", "ingest", saved, "--out", path.join(OUTPUT, name)], { cwd: PROJECT, env, timeout: 300_000, maxBuffer: 2_000_000 },
        (err, stdout, stderr) => resolve({ ok: !err, out: ((stdout || "") + (stderr || "")).slice(-600) }));
    });
    return NextResponse.json({ ok: r.ok, name: r.ok ? name : undefined, log: r.out }, { status: r.ok ? 200 : 409 });
  } finally { lock.release(); }
}
