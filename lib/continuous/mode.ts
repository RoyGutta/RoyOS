/**
 * Edge-safe mode facts for the Continuous Mode feature: environment only, no `node:` imports, so
 * middleware.ts (edge runtime) and the Node route handlers share one source of truth.
 *
 *   JARVIS_HOSTED=1   the dashboard runs on Vercel: lockdown, TOTP, durable store required (fail closed).
 *   RELAY_STAGING=1   lets the FILE store back a hosted build, but only on a loopback host (local staging/tests).
 *   DASHBOARD_PORT    the one port the local dashboard answers on (LP-6); default 4318.
 */
export function isHosted(): boolean {
  return process.env.JARVIS_HOSTED === "1";
}

export function isStaging(): boolean {
  return process.env.RELAY_STAGING === "1";
}

export function dashboardPort(): string {
  const p = (process.env.DASHBOARD_PORT ?? "").trim();
  return /^\d{2,5}$/.test(p) ? p : "4318";
}

/** LP-6: in local mode the server refuses any Host other than these two (DNS rebinding reaches it with another name). */
export function allowedLocalHosts(): string[] {
  const p = dashboardPort();
  return [`127.0.0.1:${p}`, `localhost:${p}`];
}

export function localHostAllowed(host: string | null | undefined): boolean {
  return allowedLocalHosts().includes((host ?? "").trim().toLowerCase());
}

export function isLoopbackHost(host: string | null | undefined): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test((host ?? "").trim());
}

export type StoreChoice =
  | { kind: "upstash"; url: string; token: string }
  | { kind: "file"; dir: string | null }
  | { kind: "none"; reason: string };

/**
 * Which durable store this process may use (LP-4/LP-5). Hosted mode never falls back to memory: with nothing
 * configured the answer is `none`, and every route answers 503. The file backend is a staging/test tool; a hosted
 * build accepts it only with RELAY_STAGING=1 and a loopback Host.
 */
export function chooseStore(hostHeader: string | null | undefined): StoreChoice {
  const want = (process.env.RELAY_STORE ?? "").trim().toLowerCase();
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  const upstash: StoreChoice | null = url && token && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(url) ? { kind: "upstash", url: url.replace(/\/$/, ""), token } : null;
  const fileDir = (process.env.RELAY_FILE_DIR ?? "").trim() || null;
  if (isHosted()) {
    if (want === "file") {
      if (isStaging() && isLoopbackHost(hostHeader)) return { kind: "file", dir: fileDir };
      return { kind: "none", reason: "RELAY_STORE=file is accepted in hosted mode only with RELAY_STAGING=1 on a loopback host" };
    }
    if (want && want !== "upstash") return { kind: "none", reason: "RELAY_STORE names an unknown backend" };
    if (upstash) return upstash;
    return { kind: "none", reason: "no durable store configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or RELAY_STORE=file with RELAY_STAGING=1 for loopback staging)" };
  }
  if (want === "upstash") return upstash ?? { kind: "none", reason: "RELAY_STORE=upstash but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set" };
  return { kind: "file", dir: fileDir };
}

/** Cheap env-only check used by the middleware to fail closed before any handler runs. */
export function hostedStoreConfigured(hostHeader: string | null | undefined): boolean {
  return chooseStore(hostHeader).kind !== "none";
}
