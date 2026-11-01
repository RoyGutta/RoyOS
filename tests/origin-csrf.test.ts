import assert from "node:assert/strict";
import { test } from "node:test";
import { clientBucket, clientId, csrfOk, sameOriginGuard } from "../lib/continuous/http";
import { H } from "./helpers";

const good = { host: "jarvis.example", origin: "https://jarvis.example", "sec-fetch-site": "same-origin", "content-type": "application/json" };
const HOSTED = true, LOCAL = false;

test("origin guard: accepts only an exact same-origin JSON fetch from the page", () => {
  assert.equal(sameOriginGuard(H(good), HOSTED), null);
  assert.equal(sameOriginGuard(H({ ...good, origin: "https://evil.example" }), HOSTED)?.status, 403, "foreign origin");
  assert.equal(sameOriginGuard(H({ ...good, origin: "null" }), HOSTED)?.status, 403, "opaque origin");
  assert.equal(sameOriginGuard(H({ host: "jarvis.example", "sec-fetch-site": "same-origin", "content-type": "application/json" }), HOSTED)?.status, 403, "missing origin");
  assert.equal(sameOriginGuard(H({ ...good, "sec-fetch-site": "same-site" }), HOSTED)?.status, 403, "same-site is not same-origin");
  assert.equal(sameOriginGuard(H({ ...good, "sec-fetch-site": "cross-site" }), HOSTED)?.status, 403);
  assert.equal(sameOriginGuard(H({ ...good, host: "127.0.0.1:4318", origin: "http://127.0.0.1:4319" }), LOCAL)?.status, 403, "another local port");
  assert.equal(sameOriginGuard(H({ ...good, forwarded: "for=1.2.3.4" }), HOSTED)?.status, 403, "Forwarded header");
  assert.equal(sameOriginGuard(H({ ...good, "x-forwarded-host": "other.example" }), HOSTED)?.status, 403, "foreign X-Forwarded-Host");
  assert.equal(sameOriginGuard(H({ ...good, "x-forwarded-host": "jarvis.example" }), HOSTED), null, "Vercel's own X-Forwarded-Host equals Host");
  assert.equal(sameOriginGuard(H({ ...good, "content-type": "text/plain" }), HOSTED)?.status, 415);
});

test("DC-9: the Origin's SCHEME is compared too — https on a public hosted host, http on loopback and in local mode", () => {
  assert.equal(sameOriginGuard(H({ ...good, origin: "http://jarvis.example" }), HOSTED)?.status, 403, "plain http on a public hosted host");
  assert.equal(sameOriginGuard(H({ ...good, origin: "HTTPS://JARVIS.EXAMPLE" }), HOSTED), null, "case-insensitive");
  assert.equal(sameOriginGuard(H({ ...good, origin: "https://jarvis.example:443" }), HOSTED)?.status, 403, "a browser never sends the default port; exact match only");
  const local = { host: "127.0.0.1:4318", origin: "http://127.0.0.1:4318", "sec-fetch-site": "same-origin", "content-type": "application/json" };
  assert.equal(sameOriginGuard(H(local), LOCAL), null);
  assert.equal(sameOriginGuard(H({ ...local, origin: "https://127.0.0.1:4318" }), LOCAL)?.status, 403, "local mode is plain http");
  assert.equal(sameOriginGuard(H({ ...local, host: "127.0.0.1:4555", origin: "http://127.0.0.1:4555" }), HOSTED), null, "hosted staging on loopback is plain http");
  assert.equal(sameOriginGuard(H({ ...local, host: "127.0.0.1:4555", origin: "https://127.0.0.1:4555" }), HOSTED)?.status, 403);
});

test("csrf: the X-CSRF header must equal the session value", () => {
  const csrf = "a".repeat(64);
  assert.equal(csrfOk(H({ "x-csrf": csrf }), csrf), true);
  assert.equal(csrfOk(H({ "x-csrf": "b".repeat(64) }), csrf), false);
  assert.equal(csrfOk(H({ "x-csrf": "a".repeat(63) }), csrf), false);
  assert.equal(csrfOk(H({}), csrf), false);
});

test("client identity: x-real-ip only, and only on Vercel; a spoofed X-Forwarded-For never changes the bucket", () => {
  const V = true;
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9" }), HOSTED, V), "203.0.113.9");
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1, 203.0.113.9" }), HOSTED, V), "203.0.113.9");
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.77" }), HOSTED, V), "203.0.113.9", "left-most XFF entry ignored");
  assert.equal(clientId(H({ "x-forwarded-for": "198.51.100.77" }), HOSTED, V), "shared", "no platform IP → one shared bucket, not the attacker's choice");
  assert.equal(clientId(H({ "x-real-ip": "not an ip <script>" }), HOSTED, V), "shared");
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9" }), LOCAL, V), "local");
  // DC-8: off Vercel nobody overwrites x-real-ip, so a client could pick its own bucket — every client shares one.
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9" }), HOSTED, false), "shared");
  assert.equal(clientId(H({ "x-real-ip": "198.51.100.1" }), HOSTED, false), clientId(H({ "x-real-ip": "198.51.100.2" }), HOSTED, false));
  assert.equal(clientId(H({ "x-real-ip": "203.0.113.9" }), HOSTED), "shared", "the default follows VERCEL=1, which this test process does not set");
});

test("DC-8: IPv6 clients are bucketed by /64 (normalised), IPv4-mapped addresses by their IPv4, and junk shares one bucket", () => {
  assert.equal(clientBucket("2001:db8:1:2:aaaa:bbbb:cccc:1"), "2001:db8:1:2::/64");
  assert.equal(clientBucket("2001:db8:1:2:dddd::9"), "2001:db8:1:2::/64", "another interface id, same /64");
  assert.equal(clientBucket("2001:0DB8:0001:0002::9"), "2001:db8:1:2::/64", "leading zeros, case and :: normalise");
  assert.notEqual(clientBucket("2001:db8:1:3::1"), "2001:db8:1:2::/64", "the next /64 is another bucket");
  assert.equal(clientBucket("::ffff:203.0.113.9"), "203.0.113.9", "IPv4-mapped IPv6 is the IPv4");
  assert.equal(clientBucket("::1"), "0:0:0:0::/64");
  assert.equal(clientBucket("203.0.113.9"), "203.0.113.9");
  for (const junk of ["1::2::3", "2001:db8:1:2:3:4:5:6:7", "gggg::1", "1:2:3:4:5:6:7", "::ffff:999.1.1.1", "", "203.0.113.999", "1:2:3:4:5:6:7::8"]) assert.equal(clientBucket(junk), "shared", junk);
});
