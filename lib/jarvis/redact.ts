import type { PendingApproval } from "./types";

/**
 * Redaction for text the dashboard writes into the voice line's inbox. Mirrors the
 * key shapes in voice-line/redact.py (the runtime redacts its own ledger, events and
 * audit). Applied BEFORE the text is persisted, so a pasted secret never reaches the
 * inbox file, the model, or any log. Keep the two pattern lists in step.
 */
const PATTERNS: [RegExp, string][] = [
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]"],
  [/\bbasic\s+[A-Za-z0-9+/=]{12,}/gi, "Basic [redacted]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]"],
  [/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://[redacted]@"],
  [/\b(?:sk|rk|pk)[-_](?:live|test|ant|proj|or)?[-_]?[A-Za-z0-9_-]{12,}/g, "[redacted-key]"],
  [/\bwhsec_[A-Za-z0-9]{16,}/g, "[redacted-key]"],
  [/\bhf_[A-Za-z0-9]{20,}/g, "[redacted-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted-key]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted-key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]"],
  [/\b([a-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret|authorization)[a-z0-9_.-]*)(["']?\s*(?:[=:]|\bis\b)\s*["']?)([^\s"'&,;}]{6,})/gi, "$1$2[redacted]"],
  [/(?<![\w/])(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\w)/g, "[redacted-phone]"],
  [/(?<![\w/.-])\+?1?\d{10}(?![\w-]|\.\d)/g, "[redacted-phone]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/**
 * OB-10: the only approval cards that may show an unmasked recipient and text — Roy's own step 1 / step 2 review of an
 * outbound message (voice-line/outbound_tools.py). Tool names arrive with or without the `mcp__jarvis__` prefix.
 */
export const OUTBOUND_REVIEW_TOOLS: ReadonlySet<string> = new Set(["outbound_review", "outbound_send"]);

export function isOutboundReviewCard(p: Pick<PendingApproval, "tool">): boolean {
  return OUTBOUND_REVIEW_TOOLS.has(String(p.tool ?? "").replace(/^mcp__jarvis__/, ""));
}

/** Which click of the outbound two-step this card is (1 = review recipients and text, 2 = final send), or null. */
export function outboundStep(p: Pick<PendingApproval, "tool">): 1 | 2 | null {
  if (!isOutboundReviewCard(p)) return null;
  return String(p.tool).replace(/^mcp__jarvis__/, "") === "outbound_send" ? 2 : 1;
}

/**
 * The pending approval as the dashboard may show it. Every string is masked (the runtime masks too — this is idempotent,
 * defence in depth) EXCEPT, on Roy's own local dashboard, the outbound review card's `fullText`: the full recipient and
 * the exact text, because Roy must see exactly who and what he is approving (OB-10; the runtime leaves that one field
 * unmasked for those two tools). Hosted mode, every other card, and everything that goes to events, audit or logs stay
 * masked.
 */
export function redactApprovalForCard(p: PendingApproval, hosted: boolean): PendingApproval {
  const exempt = !hosted && isOutboundReviewCard(p);
  const out: PendingApproval = { ...p, tool: String(p.tool ?? ""), description: redact(String(p.description ?? "")) };
  for (const k of ["action", "target", "effect", "cost", "category"] as const) if (typeof p[k] === "string") out[k] = redact(p[k] as string);
  if (typeof p.fullText === "string") out.fullText = exempt ? p.fullText.slice(0, 4000) : redact(p.fullText);
  else delete out.fullText;
  return out;
}
