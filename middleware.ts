import { NextResponse, type NextRequest } from "next/server";
import { allowedLocalHosts, chooseStore, hostedHostCheck, isHosted, localHostAllowed } from "@/lib/continuous/mode";
import { readCookie, sessionCookieName, verifySessionCookie } from "@/lib/continuous/session";

/**
 * LOCAL mode (default): every request must carry one of the two allowed Hosts (127.0.0.1:4318 / localhost:4318, LP-6);
 * a DNS-rebound page reaches this server with its own hostname and is refused for reads and writes alike. The relay
 * routes do not exist locally.
 *
 * HOSTED mode (JARVIS_HOSTED=1): answer only the canonical Host (JARVIS_CANONICAL_HOST; any other Host is 421, and a
 * public Host with none set is 503); fail closed with 503 when no durable store is configured; otherwise serve ONLY
 * /login, /logout, /continuous, /api/auth/*, /api/continuous/*, /api/link/* and Next's static assets. Everything else —
 * every file-reading API and page of the local dashboard — is 404. Pages need a session cookie that verifies (the
 * record is checked again by the page); /api/continuous/* answers 401 without one. Security headers: a per-request
 * nonce CSP (no inline script without the nonce, no eval), frame-ancestors none, nosniff, no-referrer, HSTS, no-store.
 */
const PAGES = new Set(["/login", "/logout", "/continuous"]);
const API_PREFIXES = ["/api/auth/", "/api/continuous/", "/api/link/"];

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function secure(res: NextResponse, hosted: boolean, csp?: string): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Frame-Options", "DENY");
  if (hosted) {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.headers.set("Cache-Control", "no-store");
    if (csp) res.headers.set("Content-Security-Policy", csp);
  }
  return res;
}

const notFound = (hosted: boolean, csp?: string) => secure(new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }), hosted, csp);

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const path = req.nextUrl.pathname;
  const hosted = isHosted();

  if (!hosted) {
    if (!localHostAllowed(host)) return secure(NextResponse.json({ ok: false, error: `this dashboard answers only on ${allowedLocalHosts().join(" or ")}` }, { status: 403 }), false);
    if (path.startsWith("/api/link/")) return notFound(false);
    return NextResponse.next();
  }

  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`;
  const pin = hostedHostCheck(host);
  if (!pin.ok) return secure(NextResponse.json({ ok: false, error: pin.error }, { status: pin.status }), true, csp);
  if (chooseStore(host).kind === "none") return secure(NextResponse.json({ ok: false, error: "no durable store configured; refusing to serve (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)" }, { status: 503 }), true, csp);
  if (path === "/") return secure(NextResponse.redirect(new URL("/continuous", req.url)), true, csp);
  const isPage = PAGES.has(path);
  const isApi = API_PREFIXES.some((p) => path.startsWith(p));
  if (!isPage && !isApi && !path.startsWith("/_next/")) return notFound(true, csp);

  let signedIn = false;
  if (isPage || path.startsWith("/api/continuous/") || path === "/api/auth/logout") {
    const key = process.env.SESSION_KEY ?? "";
    signedIn = /^[a-f0-9]{64}$/i.test(key) && (await verifySessionCookie(readCookie(req.headers.get("cookie"), sessionCookieName(true)), key)) !== null;
  }
  if (path === "/login" && signedIn) return secure(NextResponse.redirect(new URL("/continuous", req.url)), true, csp);
  if ((path === "/continuous" || path === "/logout") && !signedIn) {
    const to = new URL("/login", req.url);
    to.searchParams.set("next", path);
    return secure(NextResponse.redirect(to), true, csp);
  }
  if (path.startsWith("/api/continuous/") && !signedIn) return secure(NextResponse.json({ ok: false, error: "sign in required" }, { status: 401 }), true, csp);

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", csp);
  return secure(NextResponse.next({ request: { headers: reqHeaders } }), true, csp);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
