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
