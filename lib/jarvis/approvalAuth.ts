import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Approval signing. A yes that reaches the runtime from this server carries an HMAC over the exact
 * approval scope, keyed by ~/Library/Application Support/Jarvis/approval_secret (0600). The runtime,
 * its model and its workers are held from reading that file; this server signs on behalf of the
 * button Roy pressed — and only after lib/jarvis/approvalSession.ts has tied that press to Roy's
 * Continuous Mode session (G9-2). The browser never sees the secret or the signature.
 * Scopes: apr:<id> · task:<task>:<apr> · plan:<project>:<hash> (argv) ·
 *         first:deploy:<project>:<hash>:<nonce>:<issuedAt> / deploy:<project>:<hash>:<nonce>:<issuedAt2> (stdin) ·
 *         first:content:<id>:<version>:<nonce>:<issuedAt> / content:<id>:<version>:<nonce>:<issuedAt2> (stdin).
 */
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

function realSign(scope: string): string {
  return createHmac("sha256", secret()).update(scope, "utf8").digest("hex");
}

export type Signer = (scope: string) => string;
let signer: Signer = realSign;
/** Tests only: a signer over a test key, so no test touches Roy's approval secret. */
export function setSignerForTests(s: Signer | null) { signer = s ?? realSign; }

export function signApproval(scope: string): string {
  return signer(scope);
}
