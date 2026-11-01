import path from "node:path";

/**
 * Central configuration. Every path the dashboard reads is derived from VAULT.
 * The dashboard is READ ONLY — nothing here ever writes to the vault.
 */

export const VAULT =
  process.env.ROYOS_VAULT?.trim() || "/Users/roygutta/Documents/RoyOS";

/**
 * The live RoyOS vault (~/Documents/RoyOS) is pre-cutover and OFF-LIMITS — not
 * even for reading — until Roy authorises a cutover. Every vault read in this
 * app goes through lib/fs.ts, which refuses while VAULT_BLOCKED is true. To
 * view it deliberately, set ROYOS_VAULT_AUTHORIZED=1 (or point ROYOS_VAULT at
 * the runtime's scratch vault). Decision 2026-10-11.
 */
const LIVE_VAULT = "/Users/roygutta/Documents/RoyOS";
export const VAULT_BLOCKED =
  path.resolve(VAULT) === LIVE_VAULT || path.resolve(VAULT).startsWith(LIVE_VAULT + path.sep)
    ? process.env.ROYOS_VAULT_AUTHORIZED !== "1"
    : false;
export const VAULT_BLOCKED_REASON =
  "The live RoyOS vault is pre-cutover and unauthorised for reading. Set ROYOS_VAULT_AUTHORIZED=1 only when Roy authorises the cutover, or point ROYOS_VAULT at the runtime's scratch vault.";

export const OLLAMA_HOST =
  process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";

/** How stale state.lastRun may be before we call the loop "stopped". */
export const HEARTBEAT_SECONDS = Number(
  process.env.ROYOS_HEARTBEAT_SECONDS || 45,
);

/** Canonical files the orchestrator maintains (see 08 AI/Agents/orchestrator.js). */
export const FILES = {
  state: path.join(VAULT, "09 Logs/state.json"),
  memoryJson: path.join(VAULT, "09 Logs/memory.json"),
  memoryMd: path.join(VAULT, "09 Logs/memory.md"),
  // orchestrator.js writes the LIVE execution log here (JSONL, one event per line)…
  logJsonl: path.join(VAULT, "09 Logs/execution-log.jsonl"),
  // …and a human-readable markdown mirror lives here.
  logMd: path.join(VAULT, "09 Logs/execution-log.md"),
} as const;

/** Directories we never descend into when building the file tree. */
export const TREE_IGNORE = new Set([
  ".obsidian",
  ".git",
  ".trash",
  "node_modules",
  ".DS_Store",
]);

/** Safety caps so a pathological vault can never hang the tree walk. */
export const TREE_MAX_DEPTH = 8;
export const TREE_MAX_ENTRIES = 5000;

/** Largest file we will stream into the preview pane (bytes). */
export const PREVIEW_MAX_BYTES = 512 * 1024;
