import type {
  LogEvent,
  LogsPayload,
  MemoryEntry,
  MemoryPayload,
  MemoryDayBucket,
  StatePayload,
} from "./types";

/**
 * Pure parsers (no filesystem, no Node built-ins) that turn the raw bytes of the
 * RoyOS log/state/memory files into the structured shapes the UI consumes.
 * Kept side-effect free so they are trivial to reason about and reuse.
 */

const looksLikeIso = (s: string) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?/.test(s);

function firstLine(text: string, max = 160): string {
  const line = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
export function buildStatePayload(
  raw: { seen?: unknown; lastRun?: unknown },
  heartbeatSeconds: number,
  now = Date.now(),
): StatePayload {
  const seen = Array.isArray(raw.seen)
    ? (raw.seen.filter((x) => typeof x === "string") as string[])
    : [];
  const lastRun =
    typeof raw.lastRun === "string" && raw.lastRun ? raw.lastRun : null;

  let secondsSinceLastRun: number | null = null;
  if (lastRun) {
    const t = Date.parse(lastRun);
    if (!Number.isNaN(t)) {
      secondsSinceLastRun = Math.max(0, Math.round((now - t) / 1000));
    }
  }

  const running =
    secondsSinceLastRun !== null && secondsSinceLastRun <= heartbeatSeconds;

  return {
    seen,
    seenCount: seen.length,
    lastRun,
    secondsSinceLastRun,
    running,
    heartbeatSeconds,
  };
}

// ---------------------------------------------------------------------------
// EXECUTION LOG  (execution-log.jsonl  +  execution-log.md)
// ---------------------------------------------------------------------------

function eventFromTask(
  time: string,
  task: unknown,
  source: LogEvent["source"],
): LogEvent {
  const t = (task ?? {}) as Record<string, unknown>;
  const content = typeof t.content === "string" ? t.content : null;
  const path = typeof t.path === "string" ? t.path : null;
  const type = typeof t.type === "string" ? t.type : "task";
  return {
    time,
    type,
    path,
    content,
    preview: content ? firstLine(content) : path ?? "",
    source,
  };
}

/** Parse the canonical JSONL log: one `{ "time", "task": {...} }` per line. */
function parseJsonl(text: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const time =
        typeof obj.time === "string" ? obj.time : new Date(0).toISOString();
      out.push(eventFromTask(time, obj.task ?? obj, "jsonl"));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/**
 * Parse the markdown mirror. Each entry is:
 *   - 2026-07-03T08:09:45.257Z
 *     {"type":"write_note","path":"...","content":"..."}
 */
function parseLogMd(text: string): LogEvent[] {
  const out: LogEvent[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^-\s+(\S+)\s*$/);
    if (!m || !looksLikeIso(m[1])) continue;
    const time = m[1];
    // find the next non-empty line — the JSON payload
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const payload = j < lines.length ? lines[j].trim() : "";
    if (payload.startsWith("{")) {
      try {
        out.push(eventFromTask(time, JSON.parse(payload), "md"));
        continue;
      } catch {
        /* fall through to plain-text handling */
      }
    }
    out.push({
      time,
      type: "note",
      path: null,
      content: payload || null,
      preview: firstLine(payload),
      source: "md",
    });
  }
  return out;
}

export function parseLogs(
  jsonlText: string | null,
  mdText: string | null,
): LogsPayload {
  const jsonl = jsonlText ? parseJsonl(jsonlText) : [];
  const md = mdText ? parseLogMd(mdText) : [];

  // JSONL is the live source of truth; dedupe md entries that it already covers.
  const seen = new Set(jsonl.map((e) => `${e.time}|${e.path ?? ""}`));
  const merged = [...jsonl];
  for (const e of md) {
    const key = `${e.time}|${e.path ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(e);
    }
  }

  merged.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

  return {
    events: merged,
    count: merged.length,
    lastEventAt: merged.length ? merged[0].time : null,
  };
}

// ---------------------------------------------------------------------------
// MEMORY  (memory.json  +  memory.md)
// ---------------------------------------------------------------------------

function splitTimestamped(entry: string): { time: string | null; text: string } {
  const trimmed = entry.trim();
  const sp = trimmed.indexOf(" ");
  if (sp > 0) {
    const head = trimmed.slice(0, sp);
    if (looksLikeIso(head)) {
      return { time: head, text: trimmed.slice(sp + 1).trim() };
    }
  }
  return { time: null, text: trimmed };
}

function parseMemoryMd(text: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  const lines = text.split("\n");
  let current: MemoryEntry | null = null;
  for (const raw of lines) {
    const m = raw.match(/^-\s+(\S+)\s*$/);
    if (m && looksLikeIso(m[1])) {
      if (current) out.push(current);
      current = { time: m[1], text: "", source: "md" };
      continue;
    }
    if (current && raw.trim()) {
      current.text = current.text ? current.text + " " + raw.trim() : raw.trim();
    }
  }
  if (current) out.push(current);
  return out.filter((e) => e.text.length > 0);
}

function growthBuckets(entries: MemoryEntry[]): MemoryDayBucket[] {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    if (!e.time) continue;
    const day = e.time.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const days = [...byDay.keys()].sort();
  let cumulative = 0;
  return days.map((day) => {
    const count = byDay.get(day) ?? 0;
    cumulative += count;
    return { day, count, cumulative };
  });
}

export function parseMemory(
  memoryJson: { log?: unknown } | null,
  memoryMdText: string | null,
): MemoryPayload {
  const fromJson: MemoryEntry[] = Array.isArray(memoryJson?.log)
    ? (memoryJson!.log as unknown[])
        .filter((x): x is string => typeof x === "string")
        .map((s) => ({ ...splitTimestamped(s), source: "json" as const }))
    : [];

  const fromMd = memoryMdText ? parseMemoryMd(memoryMdText) : [];

  // Merge, preferring the live JSON log. Dedupe by (time + text head).
  const key = (e: MemoryEntry) =>
    `${e.time ?? ""}|${e.text.slice(0, 64).toLowerCase()}`;
  const seen = new Set(fromJson.map(key));
  const merged = [...fromJson];
  for (const e of fromMd) {
    if (!seen.has(key(e))) {
      seen.add(key(e));
      merged.push(e);
    }
  }

  merged.sort((a, b) => {
    const at = a.time ?? "";
    const bt = b.time ?? "";
    return at < bt ? 1 : at > bt ? -1 : 0;
  });

  return {
    entries: merged,
    count: merged.length,
    latest: merged[0] ?? null,
    growth: growthBuckets(merged),
  };
}
