"use client";

import { usePolling } from "./usePolling";

export type ApprovalSessionState = "loading" | "signed-in" | "signed-out" | "error";
export interface ApprovalSession { state: ApprovalSessionState; csrf: string | null; error: string | null; refresh: () => void }

/**
 * G9-2: whether this browser holds a Continuous Mode login session, and the X-CSRF value an approval must carry.
 * Re-read every minute while the tab is visible and on demand (after a 401). Nothing here signs anything: the server
 * checks the session and the header again on every approval route.
 */
export function useApprovalSession(): ApprovalSession {
  const { data, error, refresh } = usePolling<{ ok?: boolean; csrf?: string }>("/api/auth/session", 60_000);
  const csrf = data?.ok === true && typeof data.csrf === "string" ? data.csrf : null;
  const state: ApprovalSessionState = error === "HTTP 401" ? "signed-out" : error ? "error" : csrf ? "signed-in" : "loading";
  return { state, csrf: state === "signed-in" ? csrf : null, error, refresh };
}

/** Headers for a POST that signs an approval: JSON plus the session-bound X-CSRF, the way ContinuousMode.tsx sends it. */
export function approvalHeaders(csrf: string | null | undefined): Record<string, string> {
  return csrf ? { "content-type": "application/json", "x-csrf": csrf } : { "content-type": "application/json" };
}
