import { JARVIS_DIR } from "@/lib/jarvis/runs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * READ-ONLY view of the Business OS store shared with Jarvis
 * (~/Developer/Jarvis/business/business.json, written by voice-line/business.py).
 * The dashboard never writes it: every mutation goes through Jarvis's scoped
 * business_* tools, which is the single audited write path.
 */
export const BUSINESS_DIR =
  process.env.JARVIS_BUSINESS_DIR?.trim() || path.join(JARVIS_DIR, "business");   // the live store voice-line/business.py writes (never the iCloud twin)
const STORE = path.join(BUSINESS_DIR, "business.json");

export const LEAD_STAGES = ["PROSPECT", "CONTACTED", "REPLIED", "QUALIFIED", "CALL", "PROPOSAL", "WON", "DELIVERY", "RETAINER"] as const;
export const CONTENT_STAGES = ["IDEA", "RESEARCH", "SCRIPT", "ASSETS", "RENDER", "QA", "APPROVAL", "QUEUE", "PUBLISHED", "ANALYTICS"] as const;

interface Base { id: string; createdAt: string; updatedAt: string; status: string }
export interface Lead extends Base { business: string; contact: string; website: string; source: string; serviceInterest: string; estimatedValue: number; notes: string; lastContacted: string | null; nextFollowUp: string | null; proposalId: string | null; projectId: string | null; clientId: string | null }
export interface Client extends Base { name: string; contact: string; website: string; leadId: string | null; retainer: { amount: number; renews: string } | null; notes: string }
export interface Project extends Base { name: string; kind: string; clientId: string | null; deadline: string | null; progress: number; notes: string; contentIds: string[] }
export interface Task extends Base { title: string; projectId: string | null; due: string | null; order: number }
export interface Doc extends Base { type: string; title: string; path: string; linkedId: string | null; linkedKind: string | null; sent: boolean }
export interface ContentItem extends Base { title: string; platform: string; hook: string; projectId: string | null; notes: string; url: string | null; analytics: unknown }
export interface RevenueEvent extends Base { amount: number; currency: string; channel: string; clientId: string | null; projectId: string | null; recurring: boolean; date: string; note: string; provenance: string }
export interface AuditEntry { id: string; at: string; actor: string; action: string; entity: string | null; result: string; approval: string }

export interface BusinessStore {
  version: number; leads: Lead[]; clients: Client[]; projects: Project[]; tasks: Task[]; documents: Doc[];
  content: ContentItem[]; products: Base[]; affiliates: Base[]; revenue: RevenueEvent[]; audit: AuditEntry[];
}

const EMPTY: BusinessStore = { version: 1, leads: [], clients: [], projects: [], tasks: [], documents: [], content: [], products: [], affiliates: [], revenue: [], audit: [] };

export async function readStore(): Promise<{ store: BusinessStore; exists: boolean }> {
  try {
    const raw = await fs.readFile(STORE, "utf-8");
    return { store: { ...EMPTY, ...(JSON.parse(raw) as Partial<BusinessStore>) }, exists: true };
  } catch {
    return { store: EMPTY, exists: false };
  }
}

export interface Attention { kind: string; id: string; title: string; why: string; urgency: number }

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  // date-only means end of that local day (mirrors business.py _due)
  const t = iso.length <= 10 ? new Date(`${iso}T23:59:59`).getTime() : Date.parse(iso);
  return Number.isNaN(t) ? null : (t - Date.now()) / 86_400_000;
}

/** Mirrors business.py attention(): deterministic, reasons attached. */
export function attention(s: BusinessStore): Attention[] {
  const out: Attention[] = [];
  for (const l of s.leads) {
    if (["LOST", "UNQUALIFIED", "WON", "DELIVERY", "RETAINER"].includes(l.status)) continue;
    const d = daysUntil(l.nextFollowUp);
    if (d !== null && d <= 1) out.push({ kind: "followup", id: l.id, title: `Follow up with ${l.business}`, why: d < 0 ? "follow-up overdue" : "follow-up due today", urgency: d < 0 ? 0 : 1 });
  }
  for (const doc of s.documents) if (doc.type === "proposal" && doc.status === "REVIEW") out.push({ kind: "approval", id: doc.id, title: `Review proposal: ${doc.title}`, why: "proposal waiting for your approval", urgency: 1 });
  for (const t of s.tasks) {
    if (t.status === "DONE") continue;
    const d = daysUntil(t.due);
    if (d !== null && d <= 1) out.push({ kind: "task", id: t.id, title: t.title, why: d < 0 ? "overdue" : "due within 24 hours", urgency: d < 0 ? 0 : 1 });
  }
  for (const c of s.content) if (c.status === "APPROVAL") out.push({ kind: "content", id: c.id, title: `Approve: ${c.title}`, why: "rendered and QA-passed — waiting for your approval in the Content OS", urgency: 2 });
  for (const p of s.projects) {
    if (["DONE", "MAINTENANCE"].includes(p.status)) continue;
    const d = daysUntil(p.deadline);
    if (d !== null && d <= 2) out.push({ kind: "project", id: p.id, title: `${p.name} deadline`, why: "project deadline within 48 hours", urgency: d < 0 ? 0 : 1 });
  }
  return out.sort((a, b) => a.urgency - b.urgency);
}

export function summary(s: BusinessStore) {
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = s.revenue.filter((r) => (r.date ?? "").startsWith(month));
  const sum = (xs: RevenueEvent[]) => xs.reduce((a, r) => a + Number(r.amount || 0), 0);
  const stages: Record<string, number> = {};
  for (const l of s.leads) stages[l.status] = (stages[l.status] ?? 0) + 1;
  return {
    month,
    revenue: { received: sum(thisMonth.filter((r) => r.status === "RECEIVED")), pending: sum(s.revenue.filter((r) => r.status === "PENDING")), recurring: sum(thisMonth.filter((r) => r.recurring && r.status === "RECEIVED")), provenance: "entered locally; no payment processor connected" },
    pipeline: { value: s.leads.filter((l) => ["QUALIFIED", "CALL", "PROPOSAL"].includes(l.status)).reduce((a, l) => a + Number(l.estimatedValue || 0), 0), stages },
    clients: s.clients.filter((c) => c.status === "ACTIVE").length,
    projects: s.projects.filter((p) => p.status !== "DONE").length,
    content: Object.fromEntries(CONTENT_STAGES.map((st) => [st, s.content.filter((c) => c.status === st).length])),
    attention: attention(s),
  };
}

export const INTEGRATIONS = [
  { name: "Stripe", state: "NOT CONNECTED", note: "payment/revenue import; account must be owned by an adult (18+)" },
  { name: "GitHub", state: "NOT CONNECTED", note: "repo/PR activity; needs an authenticated token in env" },
  { name: "Vercel", state: "NOT CONNECTED", note: "deployments; production deploys stay approval-gated" },
  { name: "YouTube", state: "NOT CONNECTED", note: "analytics/publishing via official API; drafts work locally" },
  { name: "Instagram / TikTok", state: "NOT CONNECTED", note: "official APIs only; age and account rules apply" },
  { name: "Email", state: "NOT CONNECTED", note: "outreach stays DRAFT until a channel is connected and you approve" },
  { name: "Spotify (desktop)", state: "CONNECTED", note: "local AppleScript control" },
  { name: "RoyOS bridge", state: "CONNECTED", note: "durable background jobs, scratch vault only" },
] as const;
