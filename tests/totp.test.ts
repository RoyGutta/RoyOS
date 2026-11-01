import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode, hotp, totpCode, totpCounter, verifyTotp } from "../lib/continuous/totp";
import { tmpStore } from "./helpers";

/** RFC 6238 Appendix B, SHA-1, secret "12345678901234567890" (the 6-digit code is the 8-digit vector's last six digits). */
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const VECTORS: [number, string][] = [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]];

test("totp: RFC 6238 test vectors (SHA-1, 30 s, 6 digits)", () => {
  assert.equal(base32Decode(RFC_SECRET_B32)?.toString("utf8"), "12345678901234567890");
  assert.equal(base32Encode(Buffer.from("12345678901234567890")), RFC_SECRET_B32);
  for (const [t, code] of VECTORS) assert.equal(totpCode(RFC_SECRET_B32, t), code, `T=${t}`);
  assert.equal(hotp(Buffer.from("12345678901234567890"), 1, 8), "94287082");
});

test("totp: ±1 step window; two steps away is refused", () => {
  const now = 1111111111;
  const c = totpCounter(now);
  const codeFor = (counter: number) => hotp(base32Decode(RFC_SECRET_B32)!, counter);
  assert.equal(verifyTotp(RFC_SECRET_B32, codeFor(c), now), c);
  assert.equal(verifyTotp(RFC_SECRET_B32, codeFor(c - 1), now), c - 1);
  assert.equal(verifyTotp(RFC_SECRET_B32, codeFor(c + 1), now), c + 1);
  assert.equal(verifyTotp(RFC_SECRET_B32, codeFor(c - 2), now), null);
  assert.equal(verifyTotp(RFC_SECRET_B32, codeFor(c + 2), now), null);
  assert.equal(verifyTotp(RFC_SECRET_B32, "12345", now), null, "five digits");
  assert.equal(verifyTotp(RFC_SECRET_B32, "abcdef", now), null);
  assert.equal(verifyTotp("not*base32", codeFor(c), now), null);
  assert.equal(verifyTotp(RFC_SECRET_B32.toLowerCase() + "====", codeFor(c), now), c, "lower case and padding are accepted");
});

test("totp: the same code is good once per step (durable claim), so a sniffed code cannot be replayed", async () => {
  const store = tmpStore();
  const c = totpCounter(1111111111);
  assert.equal(await store.claimTotpStep(c), true);
  assert.equal(await store.claimTotpStep(c), false, "replay within the step");
  assert.equal(await store.claimTotpStep(c + 1), true, "the next step is a new code");
});
