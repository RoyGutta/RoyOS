import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { VOICE_LINE } from "@/lib/jarvis/runs";

/**
 * Approval signing. A yes that reaches the runtime from this server carries an HMAC over the exact
 * approval scope, keyed by voice-line/.voice_approval_secret (0600). The runtime, its model and its
 * workers are held from reading that file; this server (Roy's user, loopback-only, origin-guarded)
 * signs on behalf of the button Roy pressed. The browser never sees the secret or the signature
 * before the server attaches it. Scopes: apr:<id> · task:<task>:<apr> · plan:<project>:<hash> ·
 * deploy:<project>:<hash> · content:<item>.
 */
import os from "node:os";
const SECRET_DIR = path.join(os.homedir(), "Library", "Application Support", "Jarvis");
const SECRET_FILE = path.join(SECRET_DIR, "approval_secret");   // fixed path (no env override); outside every repo; 0700 dir, 0600 file

function secret(): string {
  try {
    const st = fs.statSync(SECRET_FILE); if ((st.mode & 0o077) !== 0) throw new Error("approval secret file has broad permissions; refusing");
    const s = fs.readFileSync(SECRET_FILE, "utf-8").trim();
    if (/^[a-f0-9]{64,}$/.test(s)) return s;
    throw new Error("approval secret file is corrupt; remove it to regenerate");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;   // present but rejected (modes/format): never fall through to "create"
  }
  const s = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(SECRET_FILE, s + "\n", { mode: 0o600, flag: "wx" }); return s; }
  catch {
    // a concurrent creator won: re-read through the validating path, never the raw file
    const st = fs.statSync(SECRET_FILE); if ((st.mode & 0o077) !== 0) throw new Error("approval secret file has broad permissions; refusing");
    const got = fs.readFileSync(SECRET_FILE, "utf-8").trim();
    if (!/^[a-f0-9]{64,}$/.test(got)) throw new Error("approval secret file is corrupt; remove it to regenerate");
    return got;
  }
}

export function signApproval(scope: string): string {
  return createHmac("sha256", secret()).update(scope, "utf8").digest("hex");
}
