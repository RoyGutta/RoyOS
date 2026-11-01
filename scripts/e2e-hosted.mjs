// Hosted-mode end-to-end on 127.0.0.1 with the loopback staging file store. Builds nothing: run `npm run build` first.
//   node --import ./scripts/test-hooks.mjs scripts/e2e-hosted.mjs
// Generates every key inside this process, starts `next start` on a free port with JARVIS_HOSTED=1 RELAY_STORE=file
// RELAY_STAGING=1, plays the browser and the Mac, prints STATUSES ONLY (never a key, cookie or passphrase), then stops
// the server and deletes the store directory. Exit code 1 on any failed check.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCommand } from "../lib/continuous/commands";
import { randomHex } from "../lib/continuous/crypto";
import { signLinkRequest } from "../lib/continuous/linkAuth";
import { makePassHash } from "../lib/continuous/scrypt";
import { randomTotpSecret, totpCode } from "../lib/continuous/totp";
import { hostedSnapshot } from "../tests/helpers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const step = (status, name, ok = true, note = "") => { if (!ok) failures++; console.log(`${ok ? " ok " : "FAIL"} ${String(status).padStart(3)}  ${name}${note ? `  — ${note}` : ""}`); };

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
function request(port, method, pathname, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: { ...(data ? { "content-length": String(data.length) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const passphrase = randomHex(16);
const installId = randomHex(8);
const linkKey = randomHex(32), cmdKey = randomHex(32), totpSecret = randomTotpSecret();
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jl-e2e-"));
const env = { ...process.env, JARVIS_HOSTED: "1", RELAY_STORE: "file", RELAY_STAGING: "1", RELAY_FILE_DIR: storeDir, LINK_INSTALL_ID: installId, LINK_KEY: linkKey, CMD_KEY: cmdKey, SESSION_KEY: randomHex(32), TOTP_SECRET: totpSecret, DASHBOARD_PASS_HASH: await makePassHash(passphrase) };
delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN;

console.log(`hosted e2e: next start on ${origin} (JARVIS_HOSTED=1 RELAY_STORE=file RELAY_STAGING=1)`);
const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });
const stop = () => new Promise((res) => { if (server.exitCode !== null) return res(); server.once("exit", () => res()); server.kill("SIGTERM"); setTimeout(() => { if (server.exitCode === null) server.kill("SIGKILL"); }, 5000); });

try {
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { await request(port, "GET", "/login"); up = true; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error("server did not start: " + serverLog.slice(-500));

  // --- lockdown and headers -------------------------------------------------------------------------------------
  let r = await request(port, "GET", "/api/file?path=README.md");
  step(r.status, "GET /api/file (existing file API) is 404 when hosted", r.status === 404);
  r = await request(port, "GET", "/system");
  step(r.status, "GET /system is 404 when hosted", r.status === 404);
  r = await request(port, "GET", "/");
  step(r.status, "GET / redirects to /continuous", r.status === 307 && /\/continuous$/.test(r.headers.location ?? ""));
  r = await request(port, "GET", "/continuous");
  step(r.status, "GET /continuous without a session redirects to /login", r.status === 307 && /\/login\?next=/.test(r.headers.location ?? ""));
  r = await request(port, "GET", "/login");
  const csp = r.headers["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
  const inline = [...r.text.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map((m) => m[0]);
  const nonced = inline.filter((t) => nonce && t.includes(`nonce="${nonce}"`));
  step(r.status, "GET /login renders with a nonce CSP, HSTS, nosniff", r.status === 200 && nonce.length > 10 && /max-age=31536000/.test(r.headers["strict-transport-security"] ?? "") && r.headers["x-content-type-options"] === "nosniff", `${nonced.length}/${inline.length} inline scripts carry the nonce`);
  step(r.status, "every inline script on /login carries the request nonce", inline.length > 0 && nonced.length === inline.length);

  // --- login ---------------------------------------------------------------------------------------------------
  const browser = { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", host: `127.0.0.1:${port}` };
  r = await request(port, "POST", "/api/auth/login", { headers: { ...browser, origin: "https://evil.example" }, body: JSON.stringify({ passphrase, code: "000000" }) });
  step(r.status, "login from a foreign Origin is refused", r.status === 403);
  r = await request(port, "POST", "/api/auth/login", { headers: browser, body: JSON.stringify({ passphrase: "wrong", code: totpCode(totpSecret, Date.now() / 1000) }) });
  step(r.status, "login with a wrong passphrase is 401", r.status === 401);
  r = await request(port, "POST", "/api/auth/login", { headers: browser, body: JSON.stringify({ passphrase, code: "000000" }) });
  step(r.status, "login with the right passphrase but a wrong TOTP code is 401", r.status === 401);
  r = await request(port, "POST", "/api/auth/login", { headers: browser, body: JSON.stringify({ passphrase, code: totpCode(totpSecret, Date.now() / 1000) }) });
  const setCookie = String(r.headers["set-cookie"]?.[0] ?? "");
  step(r.status, "login with passphrase + TOTP succeeds and sets a __Host- Secure HttpOnly cookie", r.status === 200 && /^__Host-jarvis_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/.test(setCookie));
  const cookie = setCookie.split(";")[0];
  const withSession = { ...browser, cookie };

  r = await request(port, "GET", "/api/continuous/status", { headers: { cookie, host: browser.host } });
  const csrf = r.json?.csrf ?? "";
  step(r.status, "status before any report: online=false, snapshot=null, csrf issued", r.status === 200 && r.json?.online === false && r.json?.snapshot === null && /^[a-f0-9]{64}$/.test(csrf));

  // --- the Mac reports --------------------------------------------------------------------------------------------
  const mac = (route, body, overrides = {}) => {
    const bytes = Buffer.from(body, "utf8");
    const ts = overrides.ts ?? Math.floor(Date.now() / 1000);
    const nonce = overrides.nonce ?? randomHex(16);
    const sig = overrides.sig ?? signLinkRequest(linkKey, installId, route, ts, nonce, bytes);
    return request(port, "POST", `/api/link/${route}`, { headers: { "content-type": "application/json", "x-link-ts": String(ts), "x-link-nonce": nonce, "x-link-sig": sig }, body: bytes });
  };
  const snapshotBody = JSON.stringify(hostedSnapshot(installId));
  r = await mac("report", snapshotBody, { sig: "0".repeat(64) });
  step(r.status, "report with a bad signature is 401", r.status === 401);
  r = await mac("report", snapshotBody, { ts: Math.floor(Date.now() / 1000) - 120 });
  step(r.status, "report with a 120 s old timestamp is 401", r.status === 401);
  r = await mac("report", "x".repeat(16 * 1024 + 1));
  step(r.status, "report over 16 KB is 413", r.status === 413);
  r = await mac("report", JSON.stringify(hostedSnapshot(installId, {}, { lastRun: { ...hostedSnapshot(installId).supervisor.lastRun, objective: "free text" } })));
  step(r.status, "report whose lastRun.objective is text is rejected (400)", r.status === 400);
  const nonceA = randomHex(16);
  r = await mac("report", snapshotBody, { nonce: nonceA });
  step(r.status, "signed report is stored", r.status === 200 && typeof r.json?.receivedAt === "string");
  r = await mac("report", snapshotBody, { nonce: nonceA });
  step(r.status, "the same nonce again is 409", r.status === 409);

  r = await request(port, "GET", "/api/continuous/status", { headers: { cookie, host: browser.host } });
  step(r.status, "status now online with the snapshot", r.status === 200 && r.json?.online === true && r.json?.snapshot?.supervisor?.display === "running" && r.json?.ageSec < 60);

  // --- the browser issues a command ------------------------------------------------------------------------------
  r = await request(port, "POST", "/api/continuous/command", { headers: withSession, body: JSON.stringify({ verb: "pause" }) });
  step(r.status, "command without X-CSRF is 403", r.status === 403);
  r = await request(port, "POST", "/api/continuous/command", { headers: { ...withSession, "x-csrf": csrf, "sec-fetch-site": "cross-site" }, body: JSON.stringify({ verb: "pause" }) });
  step(r.status, "command with Sec-Fetch-Site: cross-site is 403", r.status === 403);
  r = await request(port, "POST", "/api/continuous/command", { headers: { ...withSession, "x-csrf": csrf }, body: JSON.stringify({ verb: "start" }) });
  step(r.status, "unknown verb 'start' is 400", r.status === 400);
  r = await request(port, "POST", "/api/continuous/command", { headers: { ...withSession, "x-csrf": csrf }, body: JSON.stringify({ verb: "pause" }) });
  const cmdId = r.json?.id ?? "";
  step(r.status, "command 'pause' is signed and queued (202)", r.status === 202 && r.json?.queued === true && /^[0-9a-f-]{36}$/.test(cmdId));
  r = await request(port, "GET", "/api/continuous/status", { headers: { cookie, host: browser.host } });
  step(r.status, "status shows 1 pending command", r.json?.pending?.length === 1 && r.json.pending[0].id === cmdId && r.json.pending[0].verb === "pause");

  // --- the Mac pulls, verifies and acks -------------------------------------------------------------------------
  r = await mac("commands", "{}");
  const pulled = r.json?.commands ?? [];
  const macCheck = pulled[0] ? verifyCommand(pulled[0], { cmdKeyHex: cmdKey, installId, channel: "remote", nowSec: Math.floor(Date.now() / 1000) }) : { ok: false, reason: "nothing pulled" };
  step(r.status, "Mac pulls exactly the one command and its CMD_KEY signature verifies on channel remote", r.status === 200 && pulled.length === 1 && pulled[0].id === cmdId && macCheck.ok === true, macCheck.ok ? "" : macCheck.reason);
  const localCheck = pulled[0] ? verifyCommand(pulled[0], { cmdKeyHex: cmdKey, installId, channel: "local", nowSec: Math.floor(Date.now() / 1000) }) : { ok: true };
  step("-", "the same command is refused on channel local (channel is in the MAC)", localCheck.ok === false);
  r = await mac("ack", JSON.stringify({ id: cmdId, ok: true, message: "paused" }));
  step(r.status, "Mac acks the command", r.status === 200 && r.json?.result === "acked");
  r = await mac("ack", JSON.stringify({ id: cmdId, ok: true, message: "paused" }));
  step(r.status, "a second ack is idempotent", r.status === 200 && r.json?.result === "already");
  r = await mac("commands", "{}");
  step(r.status, "nothing left to pull", r.status === 200 && r.json?.commands?.length === 0);
  r = await request(port, "GET", "/api/continuous/status", { headers: { cookie, host: browser.host } });
  step(r.status, "status shows the result: pending empty, recent[0] = pause ok 'paused'", r.json?.pending?.length === 0 && r.json?.recent?.[0]?.id === cmdId && r.json.recent[0].ok === true && r.json.recent[0].message === "paused");

  // --- logout revokes ----------------------------------------------------------------------------------------------
  r = await request(port, "POST", "/api/auth/logout", { headers: withSession, body: "{}" });
  step(r.status, "logout clears the cookie", r.status === 200 && /Max-Age=0/.test(String(r.headers["set-cookie"]?.[0] ?? "")));
  r = await request(port, "GET", "/api/continuous/status", { headers: { cookie, host: browser.host } });
  step(r.status, "the old cookie is refused after logout (record deleted)", r.status === 401);
} catch (err) {
  failures++;
  console.log("FAIL e2e aborted: " + (err instanceof Error ? err.message : String(err)));
} finally {
  await stop();
  fs.rmSync(storeDir, { recursive: true, force: true });
  console.log(`server stopped (exit ${server.exitCode ?? server.signalCode}); store dir removed; ${failures} failure(s)`);
}
process.exit(failures ? 1 : 0);
