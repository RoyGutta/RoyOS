import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { randomHex } from "../lib/continuous/crypto";
import { signSessionId } from "../lib/continuous/session";

const ENV_KEYS = ["JARVIS_HOSTED", "RELAY_STORE", "RELAY_STAGING", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SESSION_KEY", "DASHBOARD_PORT"];
function withEnv(env: Record<string, string>, fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, env);
    try { await fn(); } finally { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  };
}
const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });
const passes = (res: Response) => res.status === 200 && res.headers.get("x-middleware-next") === "1";
const HOSTED = { JARVIS_HOSTED: "1", UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };

test("hosted lockdown: every existing file-reading API and page is 404; only the continuous surface is served", withEnv(HOSTED, async () => {
  for (const p of ["/api/file?path=x", "/api/runs", "/api/state", "/api/tree", "/api/supervisor", "/api/jarvis/ask", "/system", "/runs", "/leads", "/robots.txt", "/continuous/extra"]) {
    const res = await middleware(req(`https://jarvis.example${p}`));
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  }
  assert.ok(passes(await middleware(req("https://jarvis.example/login"))));
  assert.ok(passes(await middleware(req("https://jarvis.example/api/auth/login"))));
  assert.ok(passes(await middleware(req("https://jarvis.example/api/link/report"))), "relay routes need no cookie");
  assert.ok(passes(await middleware(req("https://jarvis.example/_next/static/chunks/app.js"))));
  const root = await middleware(req("https://jarvis.example/"));
  assert.equal(root.status, 307); assert.match(root.headers.get("location") ?? "", /\/continuous$/);
}));

test("hosted: unauthenticated page → /login, unauthenticated /api/continuous → 401, a signed cookie passes, /login bounces a signed-in user", withEnv({ ...HOSTED, SESSION_KEY: randomHex(32) }, async () => {
  const page = await middleware(req("https://jarvis.example/continuous"));
  assert.equal(page.status, 307); assert.equal(new URL(page.headers.get("location")!).pathname, "/login");
  assert.equal((await middleware(req("https://jarvis.example/api/continuous/status"))).status, 401);
  const cookie = `__Host-jarvis_session=${await signSessionId(randomHex(16), process.env.SESSION_KEY!)}`;
  const ok = await middleware(req("https://jarvis.example/continuous", { cookie }));
  assert.ok(passes(ok));
  assert.match(ok.headers.get("content-security-policy") ?? "", /script-src 'self' 'nonce-[A-Za-z0-9+/=]+'; /);
  assert.ok(!/unsafe-inline'[^;]*;\s*style/.test(ok.headers.get("content-security-policy")!.split("script-src")[1].split(";")[0]), "no unsafe-inline for scripts");
  assert.match(ok.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
  assert.ok(passes(await middleware(req("https://jarvis.example/api/continuous/status", { cookie }))));
  const forged = `__Host-jarvis_session=${await signSessionId(randomHex(16), randomHex(32))}`;
  assert.equal((await middleware(req("https://jarvis.example/api/continuous/status", { cookie: forged }))).status, 401);
  const login = await middleware(req("https://jarvis.example/login", { cookie }));
  assert.equal(login.status, 307); assert.match(login.headers.get("location") ?? "", /\/continuous$/);
}));

test("hosted fail-closed: with no durable store configured every route is 503, including the relay and the login page", withEnv({ JARVIS_HOSTED: "1" }, async () => {
  for (const p of ["/login", "/continuous", "/api/link/report", "/api/auth/login", "/api/file"]) assert.equal((await middleware(req(`https://jarvis.example${p}`))).status, 503, p);
}));

test("hosted staging: RELAY_STORE=file serves only with RELAY_STAGING=1 on a loopback host", withEnv({ JARVIS_HOSTED: "1", RELAY_STORE: "file", RELAY_STAGING: "1" }, async () => {
  assert.ok(passes(await middleware(req("http://127.0.0.1:4555/login"))));
  assert.equal((await middleware(req("https://jarvis.example/login"))).status, 503, "a public host never gets the file store");
}));

test("local mode: only 127.0.0.1:<port> / localhost:<port> are answered; relay routes do not exist", withEnv({}, async () => {
  assert.ok(passes(await middleware(req("http://127.0.0.1:4318/api/runs"))));
  assert.ok(passes(await middleware(req("http://localhost:4318/system"))));
  assert.equal((await middleware(req("http://127.0.0.1:4319/api/runs"))).status, 403, "another port");
  assert.equal((await middleware(req("http://127.0.0.1:4318/api/runs", { host: "evil.example:4318" }))).status, 403, "rebound hostname");
  assert.equal((await middleware(req("http://127.0.0.1:4318/api/link/report"))).status, 404);
  process.env.DASHBOARD_PORT = "4555";
  assert.ok(passes(await middleware(req("http://127.0.0.1:4555/api/runs"))));
  assert.equal((await middleware(req("http://127.0.0.1:4318/api/runs"))).status, 403);
}));
