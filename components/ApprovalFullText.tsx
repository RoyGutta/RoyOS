"use client";

import { outboundStep } from "@/lib/jarvis/redact";
import type { PendingApproval } from "@/lib/jarvis/types";

/**
 * The complete text behind an approval. For the outbound review card (OB-10) it is Roy's unmasked view — the full
 * recipient (name and address or number) and the exact text — because he must see exactly who and what; every other card
 * shows the runtime's masked text. Rendered as text only; the dashboard never writes it anywhere.
 */
export default function ApprovalFullText({ pending }: { pending: PendingApproval }) {
  if (!pending.fullText) return null;
  const step = outboundStep(pending);
  return (
    <div className="mb-2">
      <div className="text-[11px] text-muted mb-1">
        {step ? `Outbound message · step ${step} of 2 · recipient and text shown in full so you can check exactly who and what` : `Full text you are approving (${pending.fullText.length} characters)`}
      </div>
      <pre className="text-[12px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto border border-line rounded p-2" tabIndex={0} aria-label={step ? `Outbound message, step ${step} of 2: recipient and exact text` : "Full text of the message you are approving"}>{pending.fullText}</pre>
    </div>
  );
}
