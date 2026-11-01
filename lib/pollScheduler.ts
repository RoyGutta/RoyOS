/**
 * Polling that follows the tab (DC-5): `tick` runs now and then every `intervalMs` while the page is visible; it stops
 * while the page is hidden and runs once more the moment the page is visible again. Pure (no React), so it is tested
 * with a fake document and Node's mock timers. Returns the cancel function.
 */
export interface VisibilityDoc {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function schedulePolling(tick: () => void, intervalMs: number, doc: VisibilityDoc | null): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => { if (timer === null) { tick(); timer = setInterval(tick, intervalMs); } };
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const onVisibility = () => { if (doc?.hidden) stop(); else start(); };
  doc?.addEventListener("visibilitychange", onVisibility);
  if (!doc?.hidden) start();
  return () => { stop(); doc?.removeEventListener("visibilitychange", onVisibility); };
}
