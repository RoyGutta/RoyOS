import { randomBytes } from "node:crypto";
import { signApproval } from "./approvalAuth";

/**
 * Roy's TWO tier (Jarvis docs/APPROVALS-TWO-CLICK.md): deploying a website and publishing content take two separate
 * clicks, both tied to Roy's session by lib/jarvis/approvalSession.ts.
 *   Click 1: this server mints a nonce (32 hex, crypto-random) and issuedAt (unix seconds), signs
 *     `first:<scope>:<nonce>:<issuedAt>`, hands the CLI `{"sig","nonce","issuedAt"}` on stdin (never argv) and returns the
 *     nonce to the browser, which keeps it for that one item.
 *   Click 2: the browser sends the nonce back; the server signs `<scope>:<nonce>:<issuedAt2>` with a fresh issuedAt2.
 * The runtime enforces the rest — issuedAt within 120 s, single-use nonces, click 1 recorded for the same scope and nonce,
 * a gap of 2 s to 5 min, and the content version still current. Scopes: deploy:<project>:<siteHash12+> ·
 * content:<id>:<displayedVersion>.
 */
export const NONCE = /^[a-f0-9]{32}$/;
export const SITE_HASH = /^[a-f0-9]{12,64}$/;
export const CONTENT_VERSION = /^[a-f0-9]{64}$/;

export interface ClickAuth { stdin: string; nonce: string; issuedAt: number }

export function mintNonce(): string {
  return randomBytes(16).toString("hex");
}

function pack(message: string, nonce: string, issuedAt: number): ClickAuth {
  return { stdin: JSON.stringify({ sig: signApproval(message), nonce, issuedAt }), nonce, issuedAt };
}

export function firstClick(scope: string, nowMs = Date.now()): ClickAuth {
  const nonce = mintNonce();
  const issuedAt = Math.floor(nowMs / 1000);
  return pack(`first:${scope}:${nonce}:${issuedAt}`, nonce, issuedAt);
}

export function secondClick(scope: string, nonce: string, nowMs = Date.now()): ClickAuth {
  if (!NONCE.test(nonce)) throw new Error("nonce must be 32 hex characters");
  const issuedAt = Math.floor(nowMs / 1000);
  return pack(`${scope}:${nonce}:${issuedAt}`, nonce, issuedAt);
}
