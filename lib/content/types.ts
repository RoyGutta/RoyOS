/** Types mirroring voice-line/content_os.py (read-only on the dashboard side). */
export const STAGES = ["IDEA", "RESEARCH", "SCRIPT", "ASSETS", "RENDER", "QA", "APPROVAL", "QUEUE", "PUBLISHED", "ANALYTICS"] as const;
export type Stage = (typeof STAGES)[number] | "REJECTED" | "STOPPED";
export const FORMATS: Record<string, string> = {
  explainer: "How X actually works", data_story: "Data story", culture: "Internet-culture explainer", microdoc: "Story micro-doc",
  viral_moment: "Viral Moment Breakdown (experimental)",
};
export const RIGHTS_STATES = ["UNKNOWN", "OWNER", "LICENSED", "PERMITTED", "PUBLIC_DOMAIN", "EXCEPTION_REVIEW", "NOT_ALLOWED"] as const;
export interface Source { url: string; creator: string; title: string; rights: string; rightsNote: string; rightsBy: string | null; rightsAt: string | null; localPath: string; moments: { start: number; end: number; why: string }[]; selected: { start: number; end: number; why: string } | null }

export interface Metric { platform: string; at: string; provenance: string; views?: number; avgPctViewed?: number; avgWatchTime?: number; watchTime?: number; shares?: number; saves?: number; likes?: number; comments?: number; follows?: number; ctr?: number; completion?: number; reach?: number; policyFlag?: string }
export interface PublishRec { status: string; attempts: number; url?: string; externalId?: string; at?: string; lastError?: string }
export interface ContentItem {
  id: string; createdAt: string; updatedAt: string; status: Stage; title: string; format: string; kind: "short" | "long";
  platformTargets: string[]; angle: string; hook: string; briefId: string | null; sources: string[]; source?: Source;
  script: null | { hook: string; beats: string[]; script: string; caption: string; hashtags: string[]; thumbnail: { title: string; brief: string }; cta: string; words: number; disclosure: { aiVoice: boolean; generatedArt: boolean; credits: string[] } };
  assets: { text: string; visual: string; kind: string; source: string; license: string; credit: string; path: string }[];
  render: { status: string; startedAt?: string; finishedAt?: string; seconds?: number; video?: string; captions?: string; thumbnail?: string; error?: string; tts?: { engine: string; seconds: number; voice: string }; alignment?: { method: string; matched?: number; total?: number }; narrationSeconds?: number };
  qa: { status: string; checks: { name: string; ok: boolean; detail: string }[]; at?: string; duration?: number; lufs?: number };
  approval: { status: string; by?: string; at?: string; note?: string };
  reviewVersion?: string;   // sha256 the runtime sets when the item enters APPROVAL: what the card shows and both clicks sign (G9-5)
  schedule: { publishAt: string | null };
  publish: Record<string, PublishRec>;
  metrics: Metric[]; history: { at: string; from: string | null; to: string; by: string; note: string }[];
  errors: { at: string; stage: string; message: string }[]; notes: string;
}
export interface FormatReport { label: string; planned: number; published: number; withMetrics: number; byStage: Record<string, number>; medianViews: number | null; medianRetention: number | null; shareRate: number | null; followsPer1k: number | null; best: string | null; provenance: string[]; policyFlag: string | null; verdict: string; why: string }
export interface Report {
  generatedAt: string; paused: boolean; experiment: { start: string | null; perFormat: number; days: number; longPerFormat: number };
  formats: Record<string, FormatReport>; waitingApproval: string[];
  queue: { id: string; title: string; publishAt: string | null; targets: string[] }[];
  errors: { id: string; title: string; at: string; stage: string; message: string }[];
  platforms: { name: string; label: string; state: string; note: string }[];
  launch?: { items: { key: string; label: string; state: string; detail: string; required: boolean }[]; flags: Record<string, boolean> };
}
export interface ContentPayload { exists: boolean; items: ContentItem[]; report: Report | null; audit: { id: string; at: string; actor: string; action: string; entity: string | null; result: string; approval: string }[] }
