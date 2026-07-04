import { NextResponse } from "next/server";
import { OLLAMA_HOST } from "@/lib/config";
import type { ModelsPayload, OllamaModel } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RawOllamaModel {
  name?: string;
  model?: string;
  size?: number;
  expires_at?: string;
  details?: { family?: string; parameter_size?: string };
}

async function fetchJson(url: string, timeoutMs = 1500): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function mapModels(raw: unknown): OllamaModel[] {
  const list = (raw as { models?: RawOllamaModel[] })?.models ?? [];
  return list.map((m) => ({
    name: m.name || m.model || "unknown",
    sizeBytes: typeof m.size === "number" ? m.size : null,
    family: m.details?.family ?? null,
    parameterSize: m.details?.parameter_size ?? null,
    expiresAt: m.expires_at ?? null,
  }));
}

// GET /api/models — live Ollama status. `/api/ps` = models resident in memory
// right now (the real "active model"); `/api/tags` = everything installed.
export async function GET() {
  try {
    const [psRaw, tagsRaw] = await Promise.all([
      fetchJson(`${OLLAMA_HOST}/api/ps`),
      fetchJson(`${OLLAMA_HOST}/api/tags`),
    ]);
    const running = mapModels(psRaw);
    const installed = mapModels(tagsRaw);
    const payload: ModelsPayload = {
      ollamaUp: true,
      active: running[0]?.name ?? null,
      running,
      installed,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const payload: ModelsPayload = {
      ollamaUp: false,
      active: null,
      running: [],
      installed: [],
      error: err instanceof Error ? err.message : "Ollama unreachable",
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
