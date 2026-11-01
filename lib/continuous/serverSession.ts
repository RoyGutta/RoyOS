import { headers } from "next/headers";
import { authContext, sessionFromCookieHeader } from "./auth";
import { ConfigError } from "./config";
import { StoreError } from "./store";

/** For server components (pages): is this request signed in? Problems come back as codes, never as values. */
export type PageAuth = { ok: true } | { ok: false; reason: "none" | "config" | "store"; message: string };

export async function pageSession(): Promise<PageAuth> {
  const h = await headers();
  try {
    const ctx = authContext(h.get("host"));
    const s = await sessionFromCookieHeader(h.get("cookie"), ctx);
    return s ? { ok: true } : { ok: false, reason: "none", message: "not signed in" };
  } catch (err) {
    if (err instanceof ConfigError) return { ok: false, reason: "config", message: err.message };
    if (err instanceof StoreError) return { ok: false, reason: "store", message: err.message };
    return { ok: false, reason: "store", message: "session check failed" };
  }
}
