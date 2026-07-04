"use client";

import { usePolling, timeAgo } from "./usePolling";
import type { MemoryPayload, MemoryDayBucket } from "@/lib/types";

function Sparkline({ data }: { data: MemoryDayBucket[] }) {
  if (data.length === 0) {
    return (
      <div className="h-14 flex items-center justify-center text-muted text-[11px]">
        no dated insights yet
      </div>
    );
  }
  const w = 260;
  const h = 48;
  const max = Math.max(...data.map((d) => d.cumulative), 1);
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = data.length > 1 ? i * step : w / 2;
    const y = h - (d.cumulative / max) * (h - 4) - 2;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id="memfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4dd8c0" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#4dd8c0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#memfill)" />
      <path d={line} fill="none" stroke="#4dd8c0" strokeWidth="1.5" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill="#4dd8c0" />
      ))}
    </svg>
  );
}

export default function MemoryPanel() {
  const { data, loading, error } = usePolling<MemoryPayload>("/api/memory", 5000);
  const entries = data?.entries ?? [];
  const growth = data?.growth ?? [];
  const days = growth.length;

  return (
    <section className="panel flex flex-col min-h-0 h-full">
      <div className="panel__head">
        <span className="dot dot--active" aria-hidden />
        <span className="eyebrow">Memory</span>
        <span className="text-muted text-[11px]">insights · self-authored</span>
        <span className="ml-auto chip">{data?.count ?? 0} entries</span>
      </div>

      {/* growth over time */}
      <div className="px-4 pt-3 pb-1 border-b border-line">
        <div className="flex items-baseline justify-between mb-1">
          <span className="eyebrow">Growth</span>
          <span className="text-muted text-[11px]">
            {data?.count ?? 0} over {days} day{days === 1 ? "" : "s"}
          </span>
        </div>
        <Sparkline data={growth} />
      </div>

      {/* latest insight */}
      {data?.latest && (
        <div className="px-4 py-3 border-b border-line bg-bg2/40">
          <div className="eyebrow mb-1">Latest insight</div>
          <p className="text-ink text-[12.5px] leading-relaxed">{data.latest.text}</p>
          <div className="text-muted text-[11px] mt-1">{timeAgo(data.latest.time)}</div>
        </div>
      )}

      <ul className="flex-1 min-h-0 overflow-auto">
        {entries.map((e, i) => (
          <li key={i} className="px-4 py-2.5 border-b border-line hover-line">
            <div className="flex items-baseline gap-2">
              <span className="text-accent text-[11px] shrink-0 w-2">›</span>
              <p className="text-dim text-[12px] leading-relaxed flex-1">{e.text}</p>
            </div>
            <div className="text-muted text-[10.5px] mt-1 pl-4" title={e.time ?? ""}>
              {e.time ? timeAgo(e.time) : "undated"} · {e.source}
            </div>
          </li>
        ))}

        {entries.length === 0 && (
          <li className="px-4 py-10 text-center text-muted">
            {loading
              ? "Reading memory…"
              : error
                ? `Memory unavailable · ${error}`
                : "Memory is empty. The agent writes insights here via memory_update."}
          </li>
        )}
      </ul>
    </section>
  );
}
