import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { JARVIS_DIR, VOICE_LINE, readRuns, runSummary } from "@/lib/jarvis/runs";
import { envPresence, exists, portOpen, which } from "@/lib/jarvis/system";
import { INTEGRATIONS } from "@/lib/business/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;


/** GET /api/system — what is actually up right now. Ports are probed, files checked, env NAMES listed. */
export async function GET() {
  const [whisper, kokoro, visualizer, ollama, runs, env] = await Promise.all([
    portOpen(2022), portOpen(8880), portOpen(8777), portOpen(11434), readRuns(), envPresence(),
  ]);
  let voice: { running: boolean; state: string; detail: string; ageSeconds: number | null } = { running: false, state: "OFFLINE", detail: "", ageSeconds: null };
  try {
    const st = JSON.parse(await fs.readFile(path.join(VOICE_LINE, ".voice_status.json"), "utf-8")) as { state?: string; detail?: string; ts?: number };
    const age = st.ts ? Date.now() / 1000 - st.ts : null;
    const running = age !== null && age < 120;
    voice = { running, state: running ? st.state ?? "IDLE" : "OFFLINE", detail: st.detail ?? "", ageSeconds: age === null ? null : Math.round(age) };
  } catch { /* not running */ }
  const binaries = await Promise.all(["whisper-server", "ffmpeg", "ffprobe", "uv", "claude", "say"].map(async (b) => ({ name: b, path: await which(b) })));
  const models = await Promise.all(["ggml-small.en.bin", "kokoro-v1.0.onnx", "voices-v1.0.bin"].map(async (m) => ({ name: m, present: await exists(path.join(JARVIS_DIR, "models", m)) })));
  const tts = env.find((e) => e.name === "ELEVENLABS_API_KEY")?.set && env.find((e) => e.name === "ELEVEN_VOICE_ID")?.set ? "ElevenLabs → Kokoro → system voice" : kokoro ? "Kokoro (local)" : "Kokoro not up → macOS system voice";
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    // Which code is answering and which runtime it reads (local paths only; no secrets).
    source: { dashboardDir: process.cwd(), jarvisDir: JARVIS_DIR, voiceLineDir: VOICE_LINE, pid: process.pid },
    voiceLine: voice,
    services: [
      { name: "Voice line", up: voice.running, required: true, note: voice.running ? `state ${voice.state}` : "start with start-jarvis.command (needs a real Terminal for mic + Input Monitoring)" },
      { name: "whisper.cpp STT", port: 2022, up: whisper, required: true, note: whisper ? "listening" : "run-voice-line.sh starts it" },
      { name: "Kokoro TTS", port: 8880, up: kokoro, required: false, note: kokoro ? "listening" : "default local voice; the system voice speaks until it is up" },
      { name: "Visualizer", port: 8777, up: visualizer, required: false, note: visualizer ? "listening" : "optional arc-reactor view" },
      { name: "Dashboard", port: 4318, up: true, required: false, note: `this app, node ${process.version}` },
      { name: "Ollama", port: 11434, up: ollama, required: false, note: "NOT used by Jarvis; only RoyOS runtime jobs may load a local model" },
    ],
    voice: { engineOrder: tts, brain: "Claude via the Claude Code subscription (Agent SDK)", localModelInLoop: false },
    binaries, models, env,
    integrations: INTEGRATIONS,
    runs: runSummary(runs),
  }, { headers: { "Cache-Control": "no-store" } });
}
