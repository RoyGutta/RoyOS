"use client";

import { useEffect, useRef, useState } from "react";
import { usePolling, timeAgo } from "./usePolling";
import type { LogsPayload, LogEvent } from "@/lib/types";

function typeGlyph(type: string): { label: string; color: string } {
  if (/write|note|create/i.test(type)) return { label: "WROTE", color: "text-accent" };
  if (/delete|remove/i.test(type)) return { label: "DELETED", color: "text-offline" };
  if (/note/i.test(type)) return { label: "NOTE", color: "text-dim" };
  return { label: type.toUpperCase(), color: "text-active" };
}

function FeedRow({ ev, isNew }: { ev: LogEvent; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  const g = typeGlyph(ev.type);
  return (
    <li className={isNew ? "row-enter" : ""}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-2.5 border-b border-line hover-line transition-colors"
      >
        <div className="flex items-baseline gap-3">
          <span className={`text-[10.5px] tracking-widest ${g.color} w-14 shrink-0`}>
            {g.label}
          </span>
          <span className="text-ink truncate flex-1">
            {ev.path ?? <span className="text-dim italic">{ev.type}</span>}
          </span>
          <span
            className="text-muted text-[11px] shrink-0"
            title={ev.time}
          >
            {timeAgo(ev.time)}
          </span>
        </div>
        {ev.preview && (
          <div className="mt-1 pl-[68px] text-dim text-[12px] truncate">
            {ev.preview}
          </div>
        )}
        {open && ev.content && (
          <pre className="mt-2 ml-[68px] mb-1 max-h-72 overflow-auto rounded-md border border-line bg-bg2 p-3 text-[12px] text-dim whitespace-pre-wrap break-words">
            {ev.content}
          </pre>
        )}
      </button>
    </li>
  );
}

export default function TaskFeed() {
  const { data, error, loading } = usePolling<LogsPayload>("/api/logs", 3000);
  const newestSeen = useRef<string>("");
  const [flash, setFlash] = useState<Set<string>>(new Set());

  const events = data?.events ?? [];

  useEffect(() => {
    if (!events.length) return;
    const top = events[0].time;
    if (newestSeen.current && top > newestSeen.current) {
      const fresh = new Set(
        events.filter((e) => e.time > newestSeen.current).map((e) => e.time),
      );
      setFlash(fresh);
      const id = setTimeout(() => setFlash(new Set()), 1200);
      newestSeen.current = top;
      return () => clearTimeout(id);
    }
    if (!newestSeen.current) newestSeen.current = top;
  }, [events]);

  return (
    <section className="panel flex flex-col min-h-0 h-full">
      <div className="panel__head">
        <span
          className={`dot ${data?.count ? "dot--active dot--live" : "dot--offline"}`}
          aria-hidden
        />
        <span className="eyebrow">Execution Feed</span>
        <span className="text-muted text-[11px]">tail · execution-log.jsonl</span>
        <span className="ml-auto chip">{data?.count ?? 0} events</span>
      </div>

      <ol className="flex-1 min-h-0 overflow-auto">
        {events.map((ev, i) => (
          <FeedRow
            key={`${ev.time}-${ev.path ?? i}`}
            ev={ev}
            isNew={flash.has(ev.time)}
          />
        ))}

        {events.length === 0 && (
          <li className="px-4 py-10 text-center text-muted">
            {loading
              ? "Reading execution log…"
              : error
                ? `Log unavailable · ${error}`
                : "No tasks logged yet. When the agent writes a file, it appears here."}
          </li>
        )}
      </ol>
    </section>
  );
}
