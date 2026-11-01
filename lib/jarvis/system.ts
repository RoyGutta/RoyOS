import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { JARVIS_DIR } from "./runs";

/** Real checks only: a port answers, a file exists, a binary is on PATH, an env NAME is set. Values are never read back. */

export function portOpen(port: number, host = "127.0.0.1", ms = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (v: boolean) => { try { s.destroy(); } catch { /* ignore */ } resolve(v); };
    s.setTimeout(ms);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, host);
  });
}

export async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

const BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", path.join(os.homedir(), ".local/bin")];
export async function which(bin: string): Promise<string | null> {
  for (const d of [...(process.env.PATH ?? "").split(":"), ...BIN_DIRS]) {
    if (d && (await exists(path.join(d, bin)))) return path.join(d, bin);
  }
  return null;
}

/** Which of these configuration NAMES carry a non-empty value in Jarvis/.env. Never returns a value. */
export const ENV_NAMES = ["ELEVENLABS_API_KEY", "ELEVEN_VOICE_ID", "JARVIS_TTS_PREFER", "JARVIS_PTT_KEY", "PEXELS_API_KEY", "PIXABAY_API_KEY", "JARVIS_TURN_TIMEOUT", "JARVIS_RESUME_HOURS"] as const;
export async function envPresence(): Promise<{ name: string; set: boolean }[]> {
  let text = "";
  try { text = await fs.readFile(path.join(JARVIS_DIR, ".env"), "utf-8"); } catch { /* no .env */ }
  const set = new Set<string>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, v] = t.split("=", 2);
    if (v.trim().replace(/^["']|["']$/g, "").length > 0) set.add(k.trim());
  }
  return ENV_NAMES.map((name) => ({ name, set: set.has(name) }));
}
