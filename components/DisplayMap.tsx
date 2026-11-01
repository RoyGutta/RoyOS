"use client";

import { usePolling } from "./usePolling";

interface Display {
  label: string; how: string; position: string; name: string | null; uuid: string; builtin: boolean; primary: boolean;
  bounds: [number, number, number, number]; points: [number, number] | null; scale: number | null; refresh_hz: number | null;
  diagonal_in: number | null; ambiguous: boolean;
}
interface Payload { snapshot: { at: string; fingerprint: string; displays: Display[]; front_display: string | null } | null; ageSeconds: number | null }

/** Roy's displays as Jarvis last saw them, drawn to scale in the macOS arrangement (negative origins included). */
export default function DisplayMap() {
  const { data, error } = usePolling<Payload>("/api/displays", 10000);
  if (error) return <div className="text-offline text-[12px] p-4">display map failed: {error}</div>;
  const snap = data?.snapshot;
  if (!snap || snap.displays.length === 0)
    return <section className="panel px-4 py-3 text-[12px] text-muted">Display map: no inventory yet. Run <code>voice-line/.venv/bin/python scripts/display_demo.py</code> in Terminal, or ask Jarvis which screen a window is on.</section>;
  const xs = snap.displays.flatMap((d) => [d.bounds[0], d.bounds[0] + d.bounds[2]]);
  const ys = snap.displays.flatMap((d) => [d.bounds[1], d.bounds[1] + d.bounds[3]]);
  const minX = Math.min(...xs), minY = Math.min(...ys), W = Math.max(...xs) - minX, H = Math.max(...ys) - minY;
  const s = 640 / Math.max(W, 1);
  return (
    <section className="panel flex flex-col">
      <div className="panel__head"><span className="eyebrow">Displays</span>
        <span className="text-muted text-[11px]">as of {new Date(snap.at).toLocaleTimeString()} ({data?.ageSeconds ?? "?"}s ago) · fingerprint {snap.fingerprint}</span></div>
      <div className="px-4 py-3 overflow-x-auto">
        <svg width={W * s + 2} height={H * s + 2} role="img" aria-label="Display arrangement">
          {snap.displays.map((d) => {
            const [x, y, w, h] = d.bounds; const front = snap.front_display === d.label;
            return (
              <g key={d.uuid}>
                <rect x={(x - minX) * s + 1} y={(y - minY) * s + 1} width={w * s} height={h * s} rx={4}
                      className={front ? "fill-accent/20 stroke-accent" : "fill-panel stroke-muted"} strokeWidth={front ? 2 : 1} />
                <text x={(x - minX) * s + 8} y={(y - minY) * s + 18} className="fill-ink text-[12px]">{d.label}{d.ambiguous ? " (ambiguous)" : ""}</text>
                <text x={(x - minX) * s + 8} y={(y - minY) * s + 34} className="fill-muted text-[10.5px]">{d.name ?? "?"} · {d.points?.[0]}×{d.points?.[1]} @{d.scale}x</text>
                <text x={(x - minX) * s + 8} y={(y - minY) * s + 48} className="fill-muted text-[10.5px]">{d.position}{d.primary ? " · menu bar" : ""}{front ? " · front window" : ""}</text>
              </g>
            );
          })}
        </svg>
        <table className="table mt-3"><thead><tr><th scope="col">Label</th><th scope="col">Name</th><th scope="col">Identified by</th><th scope="col">Points</th><th scope="col">Scale</th><th scope="col">Refresh</th><th scope="col">EDID size</th><th scope="col">Origin</th></tr></thead><tbody>
          {snap.displays.map((d) => <tr key={d.uuid}><td className="text-ink">{d.label}</td><td>{d.name ?? "?"}</td><td className="text-muted">{d.how}</td><td className="tabular-nums">{d.points?.join("×")}</td><td>{d.scale}x</td><td>{d.refresh_hz ?? "?"} Hz</td><td>{d.diagonal_in ?? "?"}″</td><td className="tabular-nums text-muted">{d.bounds[0]}, {d.bounds[1]}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
}
