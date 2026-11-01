import assert from "node:assert/strict";
import { test } from "node:test";
import { clientId, csrfOk, sameOriginGuard } from "../lib/continuous/http";
import { H } from "./helpers";

const good = { host: "jarvis.example", origin: "https://jarvis.example", "sec-fetch-site": "same-origin", "content-type": "application/json" };

test("origin guard: accepts only an exact same-origin JSON fetch from the page", () => {
  assert.equal(sameOriginGuard(H(good)), null);
  assert.equal(sameOriginGuard(H({ ...good, origin: "https://evil.example" }))?.status, 403, "foreign origin");
  assert.equal(sameOriginGuard(H({ ...good, origin: "null" }))?.status, 403, "opaque origin");
  assert.equal(sameOriginGuard(H({ host: "jarvis.example", "sec-fetch-site": "same-origin", "content-type": "application/json" }))?.status, 403, "missing origin");
  assert.equal(sameOriginGuard(H({ ...good, "sec-fetch-site": "same-site" }))?.status, 403, "same-site is not same-origin");
  assert.equal(sameOriginGuard(H({ ...good, "sec-fetch-site": "cross-site" }))?.status, 403);
  assert.equal(sameOriginGuard(H({ ...good, host: "127.0.0.1:4318", origin: "http://127.0.0.1:4319" }))?.status, 403, "another local port");
  assert.equal(sameOriginGuard(H({ ...good, forwarded: "for=1.2.3.4" }))?.status, 403, "Forwarded header");
  assert.equal(sameOriginGuard(H({ ...good, "x-forwarded-host": "other.example" }))?.status, 403, "foreign X-Forwarded-Host");
  assert.equal(sameOriginGuard(H({ ...good, "x-forwarded-host": "jarvis.example" })), null, "Vercel's own X-Forwarded-Host equals Host");
  assert.equal(sameOriginGuard(H({ ...good, "content-type": "text/plain" }))?.status, 415);
});

test("csrf: the X-CSRF header must equal the session value", () => {
  const csrf = "a".repeat(64);
  assert.equal(csrfOk(H({ "x-csrf": csrf }), csrf), true);
  assert.equal(csrfOk(H({ "x-csrf": "b".repeat(64) }), csrf), false);
  assert.equal(csrfOk(H({ "x-csrf": "a".repeat(63) }), csrf), false);
  assert.equal(csrfOk(H({}), csrf), false);
});

test("client identity: x-real-ip only; a spoofed X-Forwarded-For never changes the bucket", () => {
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9" }), true), "203.0.113.9");
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1, 203.0.113.9" }), true), "203.0.113.9");
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.77" }), true), "203.0.113.9", "left-most XFF entry ignored");
  assert.equal(clientId(H({ "x-forwarded-for": "198.51.100.77" }), true), "unknown", "no platform IP → one shared bucket, not the attacker's choice");
  assert.equal(clientId(H({ "x-real-ip": "not an ip <script>" }), true), "unknown");
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9" }), false), "local");
});
