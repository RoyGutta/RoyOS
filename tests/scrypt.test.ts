import assert from "node:assert/strict";
import { test } from "node:test";
import { makePassHash, parsePassHash, scryptMaxMem, verifyPasscode } from "../lib/continuous/scrypt";

test("scrypt: the right passcode verifies and the hash is in the Mac's format", async () => {
  const h = await makePassHash("correct horse battery staple");
  assert.match(h, /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(await verifyPasscode(h, "correct horse battery staple"), true);
});

test("scrypt: a wrong passcode, an empty one and a non-string are refused", async () => {
  const h = await makePassHash("correct horse battery staple", { N: 1 << 12 });
  assert.equal(await verifyPasscode(h, "correct horse battery stapl"), false);
  assert.equal(await verifyPasscode(h, ""), false);
  assert.equal(await verifyPasscode(h, 42), false);
});

test("scrypt: malformed or out-of-range hashes are refused without throwing", async () => {
  assert.equal(parsePassHash("md5$1$2$3$ab$cd"), null);
  assert.equal(parsePassHash("scrypt$32768$8$1$zz$" + "a".repeat(64)), null);
  assert.equal(parsePassHash("scrypt$30000$8$1$" + "a".repeat(32) + "$" + "a".repeat(64)), null, "N must be a power of two");
  assert.equal(parsePassHash("scrypt$1048576$32$16$" + "a".repeat(32) + "$" + "a".repeat(64)), null, "parameters beyond the bounds");
  assert.equal(parsePassHash("scrypt$32768$8$1$" + "a".repeat(32) + "$" + "a".repeat(63)), null, "32-byte key only");
  assert.equal(await verifyPasscode("garbage", "x"), false);
  assert.equal(await verifyPasscode(null, "x"), false);
});

test("scrypt: maxmem covers Node's requirement for the contract parameters", () => {
  const N = 1 << 15, r = 8, p = 1;
  assert.ok(scryptMaxMem(N, r, p) > 128 * r * (N + 2) + 128 * r * p);
  assert.ok(scryptMaxMem(N, r, p) > 32 * 1024 * 1024, "the 32 MiB default would be refused for N=2^15, r=8");
});
