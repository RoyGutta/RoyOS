import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { VOICE_LINE } from "@/lib/jarvis/runs";

export const dynamic = "force-dynamic";

/**
 * GET /api/jarvis/audio — the REAL audio levels the voice line publishes:
 *   .voice_waveform  64 magnitudes, written ~15 Hz only while audio is playing (mouth._play)
 *   .voice_mic       32 magnitudes, written ~15 Hz only while the mic is open (ears._callback)
 * Each is "live" only when its timestamp is fresh (< 1 s). Stale files are
 * reported as not live so the UI never animates a signal that is not there.
 */
const WAVE = path.join(VOICE_LINE, ".voice_waveform");
const MIC = path.join(VOICE_LINE, ".voice_mic");
const FRESH_MS = 1000;

async function read(p: string) {
  try {
    const j = JSON.parse(await fs.readFile(p, "utf-8")) as { ts?: number; samples?: number[] };
    const ageMs = j.ts ? Date.now() - j.ts * 1000 : null;
    const samples = Array.isArray(j.samples) ? j.samples.map((x) => Math.min(1, Math.max(0, Number(x) / 32768))) : [];
    const level = samples.length ? Math.min(1, Math.sqrt(samples.reduce((a, b) => a + b, 0) / samples.length) * 2.2) : 0;
    return { live: ageMs !== null && ageMs < FRESH_MS, ageMs, level, samples };
  } catch { return { live: false, ageMs: null, level: 0, samples: [] as number[] }; }
}

export async function GET() {
  const [speaking, mic] = await Promise.all([read(WAVE), read(MIC)]);
  return NextResponse.json({ speaking, mic, now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
