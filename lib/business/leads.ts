import type { Lead } from "./store";

/**
 * Lead fields added by voice-line/leads.py (additive). The view predicates and
 * the priority formula here MIRROR leads.py: the dashboard reads the same store
 * and must never disagree with Jarvis about which leads are "high priority".
 */
export interface Evidence { id: string; kind: string; claim: string; url: string; verification: "verified" | "plausible" | "hypothesis" | "missing"; source: string; value: unknown; observedAt: string }
export interface ScoreRow { dimension: string; points: number; max: number; evidenceId: string; verification: string; note: string }
export interface LeadExtras {
  domain: string; geography: string; industry: string; discoverySource: string; sourceUrls: string[]; evidence: Evidence[];
  score: number | null; scoreBreakdown: ScoreRow[]; confidence: "LOW" | "MEDIUM" | "HIGH"; verification: "UNVERIFIED" | "NEEDS_VERIFICATION" | "VERIFIED";
  serviceFit: string[]; contactChannels: { kind: string; value: string; url: string }[]; activity: { at: string; by: string; what: string }[];
  nextAction: string; possibleDuplicates: string[]; synthetic: boolean; lastActivity?: string | null;
}
export type LeadRecord = Lead & Partial<LeadExtras>;

export const LEAD_VIEWS = ["all", "new", "needs_verification", "qualified", "high_priority", "audit_available", "proposal_ready", "awaiting_review", "contacted", "interested", "not_fit", "converted", "archived"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];
export const VIEW_LABEL: Record<LeadView, string> = {
  all: "All", new: "New", needs_verification: "Needs verification", qualified: "Qualified", high_priority: "High priority", audit_available: "Audit available",
  proposal_ready: "Proposal drafted", awaiting_review: "Awaiting review", contacted: "Contacted", interested: "Interested", not_fit: "Not a fit", converted: "Converted", archived: "Archived",
};
export const DECISIONS = ["qualified", "interested", "contacted_manually", "not_fit", "not_now", "won", "needs_verification", "verified", "archived", "reopen", "lost"] as const;
export const SERVICES = ["new_website", "redesign", "landing_page", "lead_capture", "web_app", "dashboard", "automation", "ai_integration", "maintenance"] as const;
const CLOSED = ["LOST", "NOT_NOW", "UNQUALIFIED", "WON", "DELIVERY", "RETAINER"];

export function isSynthetic(l: LeadRecord): boolean {
  const d = (l.domain ?? "").toLowerCase();
  return !!l.synthetic || /\(sample\)|\[synthetic\]/i.test(l.business) || /\.(invalid|example|test)$/.test(d) || /^example\.(com|org|net)$/.test(d);
}

export function priority(l: LeadRecord): "HIGH" | "MEDIUM" | "LOW" {
  const s = l.score ?? 0;
  if (s >= 50 && (l.confidence ?? "LOW") !== "LOW") return "HIGH";
  return s >= 30 ? "MEDIUM" : "LOW";
}

export function inView(l: LeadRecord, view: LeadView): boolean {
  const st = l.status;
  const ver = l.verification ?? "UNVERIFIED";
  switch (view) {
    case "all": return true;
    case "new": return st === "PROSPECT" && (l.activity?.length ?? 0) <= 1;
    case "needs_verification": return ["PROSPECT", "CONTACTED", "REPLIED"].includes(st) && ver !== "VERIFIED";
    case "qualified": return ["QUALIFIED", "CALL", "PROPOSAL"].includes(st);
    case "high_priority": return priority(l) === "HIGH" && !CLOSED.includes(st);
    case "audit_available": return (l.evidence ?? []).some((e) => e.source === "siteaudit");
    case "proposal_ready": return !!l.proposalId;
    case "awaiting_review": return !!l.proposalId && st === "PROPOSAL";
    case "contacted": return st === "CONTACTED";
    case "interested": return ["REPLIED", "CALL"].includes(st);
    case "not_fit": return ["UNQUALIFIED", "LOST"].includes(st);
    case "converted": return !!l.clientId;
    case "archived": return ["LOST", "NOT_NOW", "UNQUALIFIED"].includes(st);
  }
}

export function leadView(leads: LeadRecord[], view: LeadView, includeSynthetic = false): LeadRecord[] {
  return leads
    .filter((l) => (includeSynthetic || !isSynthetic(l)) && inView(l, view))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function leadCounts(leads: LeadRecord[], includeSynthetic = false): Record<LeadView, number> {
  const out = {} as Record<LeadView, number>;
  for (const v of LEAD_VIEWS) out[v] = leadView(leads, v, includeSynthetic).length;
  return out;
}
