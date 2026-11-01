import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";
import { schedulePolling } from "../lib/pollScheduler";

class FakeDoc extends EventTarget { hidden = false; }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("DC-5: polling reads now and every interval while the tab is visible, stops while it is hidden, reads at once when it is visible again, and stops on cancel", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const doc = new FakeDoc();
    let ticks = 0;
    const cancel = schedulePolling(() => { ticks++; }, 20_000, doc);
    assert.equal(ticks, 1, "one read immediately");
    mock.timers.tick(20_000); assert.equal(ticks, 2);
    mock.timers.tick(20_000); assert.equal(ticks, 3);
    mock.timers.tick(19_999); assert.equal(ticks, 3, "not before the interval");
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
    mock.timers.tick(600_000); assert.equal(ticks, 3, "nothing while hidden");
    doc.dispatchEvent(new Event("visibilitychange")); assert.equal(ticks, 3, "a repeated hidden event changes nothing");
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(ticks, 4, "one read the moment the tab is visible again");
    doc.dispatchEvent(new Event("visibilitychange")); assert.equal(ticks, 4, "a repeated visible event does not double the interval");
    mock.timers.tick(20_000); assert.equal(ticks, 5);
    cancel();
    mock.timers.tick(200_000); assert.equal(ticks, 5, "cancelled");
    doc.dispatchEvent(new Event("visibilitychange")); assert.equal(ticks, 5, "listener removed");
    const hiddenStart = new FakeDoc(); hiddenStart.hidden = true;
    let t2 = 0;
    const cancel2 = schedulePolling(() => { t2++; }, 20_000, hiddenStart);
    mock.timers.tick(100_000); assert.equal(t2, 0, "a tab opened hidden reads nothing until it is shown");
    cancel2();
    const c3 = schedulePolling(() => { ticks++; }, 20_000, null);
    assert.equal(ticks, 6, "without a document (SSR guard) it simply polls");
    c3();
  } finally { mock.timers.reset(); }
});

test("DC-5/DC-6: the Continuous Mode panel polls status every 20 s with a refresh after each command, and every cadence text says 30 s", () => {
  const panel = fs.readFileSync(path.join(ROOT, "components", "ContinuousMode.tsx"), "utf8");
  assert.match(panel, /export const STATUS_POLL_MS = 20_000;/);
  assert.match(panel, /usePolling<StatusPayload>\("\/api\/continuous\/status", STATUS_POLL_MS\)/);
  assert.match(panel, /finally \{\s*setBusy\(null\);\s*refresh\(\);/, "immediate refresh after a command");
  const hosted = fs.readFileSync(path.join(ROOT, "lib", "continuous", "adapters", "hosted.ts"), "utf8");
  for (const [name, text] of [["ContinuousMode.tsx", panel], ["hosted.ts", hosted]]) {
    assert.doesNotMatch(text, /15 s/, `${name} must not say 15 s`);
    assert.match(text, /30 s/, `${name} says 30 s`);
  }
  assert.match(panel, /the Mac reports every 30 s/);
});
