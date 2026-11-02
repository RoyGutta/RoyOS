"use client";

import type { ApprovalSession } from "./useApprovalSession";

/** The approval buttons' stand-in while this browser holds no session: a link to sign in that comes back to this page. */
export default function SignInToApprove({ session, next, small = false }: { session: ApprovalSession; next: string; small?: boolean }) {
  if (session.state === "signed-in") return null;
  if (session.state === "loading") return <span className="text-muted text-[11px]" role="status">checking sign-in…</span>;
  if (session.state === "error") return <span className="text-offline text-[11px]" role="status">sign-in check failed ({session.error}); approvals are unavailable until it works</span>;
  return <a className={`btn ${small ? "btn--sm" : ""}`} href={`/login?next=${encodeURIComponent(next)}`}>Sign in to approve</a>;
}
