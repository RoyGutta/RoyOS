import { NextResponse } from "next/server";
import { ConfigError } from "./config";
import { StoreError } from "./store";

/** JSON replies for the continuous routes: never cached, never carrying a secret or a local path. */
export function json(body: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...(headers ?? {}) } });
}

export function fail(status: number, error: string, headers?: Record<string, string>): NextResponse {
  return json({ ok: false, error }, status, headers);
}

/** Config and store problems are 503 with their one-line reason (names of missing vars/files, never values). */
export function failFrom(err: unknown): NextResponse {
  if (err instanceof ConfigError) return fail(503, err.message);
  if (err instanceof StoreError) return fail(503, err.message);
  return fail(500, "internal error");
}
