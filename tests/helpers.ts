import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomHex } from "../lib/continuous/crypto";
import type { LinkKeys } from "../lib/continuous/config";
import { LinkStore } from "../lib/continuous/linkStore";
import type { Snapshot } from "../lib/continuous/snapshot";
import { fileKV } from "../lib/continuous/store/file";
import type { KV } from "../lib/continuous/store/kv";
import { makePassHash } from "../lib/continuous/scrypt";
import { randomTotpSecret } from "../lib/continuous/totp";

/** A fresh file-backed KV in a private temp dir (keys generated inside the test run, never printed). */
export function tmpKV(): KV {
  return fileKV(fs.mkdtempSync(path.join(os.tmpdir(), "jl-test-")));
}

export function tmpStore(): LinkStore {
  return new LinkStore(tmpKV());
}

export async function testKeys(passphrase = "correct horse battery staple"): Promise<LinkKeys> {
  return { installId: randomHex(8), linkKey: randomHex(32), cmdKey: randomHex(32), passHash: await makePassHash(passphrase, { N: 1 << 12 }), totpSecret: randomTotpSecret(), sessionKey: randomHex(32) };
}

export function H(h: Record<string, string>): Headers {
  return new Headers(h);
}

/** A hosted-shape snapshot that passes re-validation; override fields to make it fail. */
export function hostedSnapshot(installId: string, over: Record<string, unknown> = {}, supervisorOver: Record<string, unknown> = {}): Record<string, unknown> {
  const supervisor: Snapshot["supervisor"] = {
    display: "running", state: "RUNNING", enabled: true, launchAgentLoaded: true, paused: false, stopped: false, reason: "none",
    model: { requested: "fable", requestedId: "claude-fable-5-1", actual: "claude-fable-5-1", effort: "high" },
    currentTask: "Ship the relay", nextTask: null, taskSource: "roy",
    lastRun: { runId: "run_01", outcome: "completed", model: "fable", actualModel: "claude-fable-5-1", effort: "high", endedAt: "2026-10-31T12:00:00Z", objective: null, patchFiles: 3, agentsUsed: 2, skillsUsed: 1 },
    usage: { status: "ok", resetAt: null, modelBlocks: {} }, runsToday: 2, maxRunsPerDay: 24, nextCheckAt: "2026-10-31T12:30:00Z",
  };
  return { v: 1, at: "2026-10-31T12:05:00Z", seq: 812, installId, channel: "remote", ...over, supervisor: { ...supervisor, ...supervisorOver } };
}
