/**
 * Shared types used by both the API routes (server) and the components (client).
 * Keep this file free of any Node-only imports so it is safe to import anywhere.
 */

export interface StatePayload {
  seen: string[];
  seenCount: number;
  lastRun: string | null;
  secondsSinceLastRun: number | null;
  running: boolean;
  heartbeatSeconds: number;
}

export interface LogEvent {
  time: string; // ISO timestamp
  type: string; // task type, e.g. "write_note"
  path: string | null; // vault-relative path written
  content: string | null; // full content written (may be large)
  preview: string; // first line / trimmed content for the feed
  source: "jsonl" | "md"; // where the event came from
}

export interface LogsPayload {
  events: LogEvent[]; // newest first
  count: number;
  lastEventAt: string | null;
}

export interface MemoryEntry {
  time: string | null;
  text: string;
  source: "json" | "md";
}

export interface MemoryDayBucket {
  day: string; // YYYY-MM-DD
  count: number;
  cumulative: number;
}

export interface MemoryPayload {
  entries: MemoryEntry[]; // newest first
  count: number;
  latest: MemoryEntry | null;
  growth: MemoryDayBucket[]; // oldest -> newest, for the sparkline
}

export interface TreeNode {
  name: string;
  path: string; // vault-relative ("" for root)
  type: "dir" | "file";
  size: number;
  mtime: string | null;
  ext?: string;
  children?: TreeNode[];
  truncated?: boolean; // dir contents were capped
}

export interface TreePayload {
  root: TreeNode;
  fileCount: number;
  dirCount: number;
  vault: string;
}

export interface OllamaModel {
  name: string;
  sizeBytes: number | null;
  family?: string | null;
  parameterSize?: string | null;
  expiresAt?: string | null; // for running models: when it unloads
}

export interface ModelsPayload {
  ollamaUp: boolean;
  active: string | null; // model currently loaded in memory (best signal)
  running: OllamaModel[]; // models resident in VRAM/RAM right now
  installed: OllamaModel[]; // everything `ollama pull`ed
  error?: string;
}

export interface FilePayload {
  path: string;
  size: number;
  mtime: string | null;
  binary: boolean;
  truncated: boolean;
  content: string;
}
