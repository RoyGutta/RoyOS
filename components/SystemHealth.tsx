"use client";

import { usePolling } from "./usePolling";

interface SystemPayload {
  checkedAt: string;
  voiceLine: { running: boolean; state: string; detail: string; ageSeconds: number | null };
  services: { name: string; port?: number; up: boolean; required: boolean; note: string }[];
  voice: { engineOrder: string; brain: string; localModelInLoop: boolean };
  binaries: { name: string; path: string | null }[];
  models: { name: string; present: boolean }[];
  env: { name: string; set: boolean }[];
  integrations: readonly { name: string; state: string; note: string }[];
  runs: { total: number; byState: Record<string, number> };
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="panel flex flex-col min-h-0"><div className="panel__head"><span className="eyebrow">{title}</span>{sub && <span className="text-muted text-[11px]">{sub}</span>}</div><div className="px-4 py-3 text-[13px]">{children}</div></section>;
}

export default function SystemHealth() {
  const { data, error } = usePolling<SystemPayload>("/api/system", 8000);
  if (error) return <div className="text-offline text-[12px] p-4">system check failed: {error}</div>;
  if (!data) return <div className="text-muted text-[12px] p-4">checking…</div>;
  const required = data.services.filter((s) => s.required);
  const ok = required.every((s) => s.up);
  return (
    <div className="flex flex-col gap-4">
      <div className="panel px-4 py-3 flex flex-wrap items-center gap-3">
        <span className={`dot ${ok ? "dot--online" : "dot--offline"}`} aria-hidden />
        <span className="text-[15px] tracking-[0.14em] text-ink">SYSTEM <span className="text-accent">//</span> HEALTH</span>
        <span className="text-muted text-[11px]">{ok ? "voice loop ready" : `${required.filter((s) => !s.up).map((s) => s.name).join(", ")} down`} · checked {new Date(data.checkedAt).toLocaleTimeString()}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Services" sub="ports probed live">
          <table className="table"><thead><tr><th scope="col">Service</th><th scope="col">Port</th><th scope="col">State</th><th scope="col">Note</th></tr></thead><tbody>
            {data.services.map((s) => <tr key={s.name}><td className="text-ink">{s.name}{s.required && <span className="text-muted"> *</span>}</td><td className="text-muted tabular-nums">{s.port ?? "—"}</td><td><span className={`badge ${s.up ? "badge--ok" : s.required ? "badge--bad" : ""}`}>{s.up ? "up" : "down"}</span></td><td className="text-muted">{s.note}</td></tr>)}
          </tbody></table>
          <div className="text-muted text-[10.5px] mt-2">* required for the voice loop. Start everything: <code>~/Developer/Jarvis/start-jarvis.command</code> (real Terminal window: mic + Input Monitoring permission). Voice line only: <code>voice-line/run-voice-line.sh</code>. Health check: <code>uv run python doctor.py</code> in voice-line.</div>
        </Panel>
        <Panel title="Voice stack" sub="what actually speaks and thinks">
          <ul className="text-[12px] space-y-1">
            <li><span className="eyebrow mr-2">Brain</span><span className="text-ink">{data.voice.brain}</span></li>
            <li><span className="eyebrow mr-2">Voice order</span><span className="text-ink">{data.voice.engineOrder}</span></li>
            <li><span className="eyebrow mr-2">Local model in loop</span><span className="text-ink">{data.voice.localModelInLoop ? "yes" : "none"}</span></li>
            <li><span className="eyebrow mr-2">Voice line</span><span className="text-ink">{data.voiceLine.running ? `${data.voiceLine.state}${data.voiceLine.detail ? ` — ${data.voiceLine.detail}` : ""}` : "offline"}</span></li>
          </ul>
          <div className="eyebrow mt-3 mb-1">Binaries</div>
          <div className="flex flex-wrap gap-1">{data.binaries.map((b) => <span key={b.name} className={`badge ${b.path ? "badge--ok" : "badge--bad"}`} title={b.path ?? "not found"}>{b.name}</span>)}</div>
          <div className="eyebrow mt-3 mb-1">Models</div>
          <div className="flex flex-wrap gap-1">{data.models.map((m) => <span key={m.name} className={`badge ${m.present ? "badge--ok" : "badge--bad"}`}>{m.name}</span>)}</div>
        </Panel>
        <Panel title="Configuration" sub="names only — values are never shown">
          <table className="table"><tbody>
            {data.env.map((e) => <tr key={e.name}><td className="text-ink font-mono">{e.name}</td><td><span className={`badge ${e.set ? "badge--ok" : ""}`}>{e.set ? "set" : "empty"}</span></td></tr>)}
          </tbody></table>
          <div className="text-muted text-[10.5px] mt-2">Edit <code>~/Developer/Jarvis/.env</code>. Empty ElevenLabs keys mean Kokoro (local) is the voice; nothing else needs a key for the core loop.</div>
        </Panel>
        <Panel title="Integrations" sub="only what is actually connected is marked connected">
          <table className="table"><tbody>
            {data.integrations.map((i) => <tr key={i.name}><td className="text-ink">{i.name}</td><td><span className={`badge ${i.state === "CONNECTED" ? "badge--ok" : ""}`}>{i.state}</span></td><td className="text-muted">{i.note}</td></tr>)}
          </tbody></table>
          <div className="text-muted text-[10.5px] mt-2">Tidefable&apos;s YouTube connection is tracked separately in the <a className="text-accent" href="/content">Content OS</a> (platforms view).</div>
        </Panel>
      </div>
      <Panel title="Runs" sub="ledger">
        <div className="text-[12px] text-ink">{data.runs.total} recorded · {Object.entries(data.runs.byState).map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} ${v}`).join(" · ") || "none yet"} · <a className="text-accent" href="/runs">open</a></div>
      </Panel>
    </div>
  );
}
