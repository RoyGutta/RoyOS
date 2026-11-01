import type { NextResponse } from "next/server";
import { authContext, type AuthContext } from "./auth";
import { readBodyCapped } from "./http";
import { LINK_BODY_MAX, readLinkHeaders, verifyLinkRequest, type LinkRoute } from "./linkAuth";
import { isHosted } from "./mode";
import { fail, failFrom } from "./respond";

/** Shared entry for the three relay routes: hosted only, 16 KB cap, then the full X-Link-* verification (nonce claimed in the store). */
export async function linkEntry(req: Request, route: LinkRoute): Promise<{ ctx: AuthContext; body: Uint8Array; nowSec: number } | NextResponse> {
  if (!isHosted()) return fail(404, "not found");
  let ctx: AuthContext;
  try { ctx = authContext(req.headers.get("host")); } catch (err) { return failFrom(err); }
  const body = await readBodyCapped(req, LINK_BODY_MAX);
  if (!body.ok) return fail(body.status, body.error);
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const v = await verifyLinkRequest({ headers: readLinkHeaders(req.headers), route, body: body.bytes, installId: ctx.keys.installId, linkKeyHex: ctx.keys.linkKey, nowSec, claimNonce: (n) => ctx.store.claimNonce(n) });
    if (!v.ok) return fail(v.status, v.error);
  } catch (err) { return failFrom(err); }
  return { ctx, body: body.bytes, nowSec };
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof Response;
}
