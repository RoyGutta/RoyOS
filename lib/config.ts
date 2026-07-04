import path from "node:path";

/**
 * Central configuration. Every path the dashboard reads is derived from VAULT.
 * The dashboard is READ ONLY — nothing here ever writes to the vault.
 */

export const VAULT =
  process.env.ROYOS_VAULT?.trim() || "/Users/roygutta/Documents/RoyOS";

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
