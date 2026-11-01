import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HEX16, HEX64 } from "./crypto";
import { isHosted } from "./mode";
import { parsePassHash } from "./scrypt";
import { base32Decode } from "./totp";

export { isHosted, isStaging, localHostAllowed, allowedLocalHosts, chooseStore } from "./mode";

/**
 * Key material (contract v1.1 §Keys). Local mode reads `~/Library/Application Support/Jarvis/link.json` (fixed path,
 * no env override; refused when its mode is broader than 0600, the approvalAuth pattern). Hosted mode reads the
 * environment: LINK_INSTALL_ID, LINK_KEY, CMD_KEY, DASHBOARD_PASS_HASH, TOTP_SECRET, SESSION_KEY. Values are never
 * logged or returned to a browser; errors name only the problem.
 */
export interface LinkKeys {
  installId: string;
  linkKey: string;
  cmdKey: string;
  passHash: string;
  totpSecret: string | null;
  sessionKey: string;
}

export type ConfigErrorCode = "missing" | "mode" | "corrupt" | "incomplete";
export class ConfigError extends Error {
  code: ConfigErrorCode;
  constructor(code: ConfigErrorCode, message: string) { super(message); this.name = "ConfigError"; this.code = code; }
}

const LINK_FILE = path.join(os.homedir(), "Library", "Application Support", "Jarvis", "link.json");

function validate(src: Record<string, unknown>, names: { install: string; totpRequired: boolean }): LinkKeys {
  const s = (k: string) => (typeof src[k] === "string" ? (src[k] as string).trim() : "");
  const installId = s(names.install), linkKey = s("LINK_KEY"), cmdKey = s("CMD_KEY"), passHash = s("DASHBOARD_PASS_HASH"), sessionKey = s("SESSION_KEY"), totp = s("TOTP_SECRET");
  const bad: string[] = [];
  if (!HEX16.test(installId)) bad.push(names.install);
  if (!HEX64.test(linkKey)) bad.push("LINK_KEY");
  if (!HEX64.test(cmdKey)) bad.push("CMD_KEY");
  if (!HEX64.test(sessionKey)) bad.push("SESSION_KEY");
  if (!parsePassHash(passHash)) bad.push("DASHBOARD_PASS_HASH");
  if (totp ? !base32Decode(totp) : names.totpRequired) bad.push("TOTP_SECRET");
  if (bad.length) throw new ConfigError("incomplete", `link keys missing or malformed: ${bad.join(", ")}`);
  return { installId: installId.toLowerCase(), linkKey, cmdKey, passHash, totpSecret: totp || null, sessionKey };
}

function readLinkFile(): Record<string, unknown> {
  let st: fs.Stats;
  try { st = fs.statSync(LINK_FILE); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ConfigError("missing", "link.json not found: run `supervisor.py link-keys` and `supervisor.py dashboard-passcode` on the Mac");
    throw new ConfigError("corrupt", "link.json cannot be read");
  }
  if (!st.isFile() || (st.mode & 0o077) !== 0) throw new ConfigError("mode", "link.json has broad permissions; refusing (chmod 600)");
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(LINK_FILE, "utf-8")); } catch { throw new ConfigError("corrupt", "link.json is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ConfigError("corrupt", "link.json is not an object");
  return parsed as Record<string, unknown>;
}

export function loadKeys(): LinkKeys {
  if (isHosted()) return validate(process.env as Record<string, unknown>, { install: "LINK_INSTALL_ID", totpRequired: true });
  return validate(readLinkFile(), { install: "INSTALL_ID", totpRequired: false });
}

/** For pages: a one-word status without touching values. */
export function keysStatus(): { ok: true } | { ok: false; code: ConfigErrorCode; message: string } {
  try { loadKeys(); return { ok: true }; }
  catch (err) {
    if (err instanceof ConfigError) return { ok: false, code: err.code, message: err.message };
    return { ok: false, code: "corrupt", message: "link keys could not be loaded" };
  }
}
