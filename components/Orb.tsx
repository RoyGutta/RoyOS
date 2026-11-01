"use client";

import { useEffect, useRef } from "react";

/**
 * The central assistant visualization: concentric rings with a tick ring,
 * driven by the runtime state and the REAL audio level the voice line publishes
 * (speaker waveform while speaking, mic level while listening). When no live
 * signal exists the orb breathes slowly (idle); it never fakes a signal.
 * Reduced motion: no rotation/breathing; the level ring still scales (it is
 * information, not decoration).
 */
export type OrbMood = "offline" | "idle" | "listening" | "transcribing" | "thinking" | "tool" | "approval" | "speaking" | "error" | "done";

export function moodFor(state: string, justFinished: string | null): OrbMood {
  if (justFinished && state === "IDLE") return justFinished === "COMPLETED" ? "done" : "error";
  switch (state) {
    case "OFFLINE": return "offline";
    case "LISTENING": return "listening";
    case "TRANSCRIBING": return "transcribing";
    case "THINKING": return "thinking";
    case "TOOL_EXECUTION": return "tool";
    case "WAITING_FOR_APPROVAL": return "approval";
    case "SPEAKING": return "speaking";
    case "ERROR": return "error";
    default: return "idle";
  }
}

export default function Orb({ mood, level, live, size = 300, samples }: { mood: OrbMood; level: number; live: boolean; size?: number; samples?: number[] }) {
  const ref = useRef<SVGCircleElement>(null);
  // Level ring radius follows the live level directly (no smoothing library; a tiny lerp in a ref).
  useEffect(() => {
    const target = live ? level : 0;   // CSS transitions the radius; no stuck intermediate value
    if (ref.current) ref.current.setAttribute("r", String(96 + target * 34));
  }, [level, live]);
  const ticks = Array.from({ length: 72 }, (_, i) => i);
  const bars = (samples && samples.length ? samples : []).slice(0, 32);
  return (
    <div className={`orb orb--${mood}`} style={{ width: size, height: size }} role="img" aria-label={`Jarvis ${mood}${live ? ", live audio" : ""}`}>
      <svg viewBox="0 0 400 400" width={size} height={size} aria-hidden>
        <defs>
          <radialGradient id="orbCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--hud-core)" stopOpacity="0.95" />
            <stop offset="55%" stopColor="var(--hud-glow)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--hud-glow)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* outer tick ring (the wall-screen reference) */}
        <g className="orb__ticks">
          {ticks.map((i) => (
            <line key={i} x1="200" y1="14" x2="200" y2={i % 6 === 0 ? "30" : "22"} transform={`rotate(${i * 5} 200 200)`} />
          ))}
        </g>
        <circle className="orb__ring orb__ring--outer" cx="200" cy="200" r="178" />
        <circle className="orb__ring orb__ring--dash" cx="200" cy="200" r="160" strokeDasharray="6 10" />
        <circle className="orb__ring orb__ring--arc" cx="200" cy="200" r="142" strokeDasharray="220 700" />
        <circle className="orb__ring orb__ring--mid" cx="200" cy="200" r="124" />
        {/* live level ring: radius = f(real audio level) */}
        <circle ref={ref} className="orb__level" cx="200" cy="200" r="96" />
        {/* live bars around the core when a waveform is present */}
        {live && bars.length > 0 && (
          <g className="orb__bars">
            {bars.map((v, i) => (
              <line key={i} x1="200" y1={200 - 100} x2="200" y2={200 - 100 - Math.min(26, 4 + v * 90)} transform={`rotate(${(360 / bars.length) * i} 200 200)`} />
            ))}
          </g>
        )}
        <circle className="orb__core" cx="200" cy="200" r="92" fill="url(#orbCore)" />
        <circle className="orb__core-ring" cx="200" cy="200" r="74" />
      </svg>
    </div>
  );
}
