import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * R14-1/R14-2 (Sidebar re-check 14): Jarvis's sandboxed shell can write most of this project's tree (not this file). Next loads
 * .env.<mode>[.local] into process.env BEFORE it starts its dev and build workers, so a planted NODE_OPTIONS there runs a planted
 * module inside them; the same files can set the session key, the vault switch and the relay/Upstash addresses. Until the whole
 * tree is write-denied (Roy's decision 13), dev, build and start refuse while any of these exists. .env and .env.local (both
 * write-denied) are allowed.
 */
export function hookGuard(root, env = process.env) {
  const problems = [];
  const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  for (const n of list(root)) {
    if (/^\.env\.(development|production|test)(\.local)?$/.test(n)) problems.push(`${n} (Next loads it into every process)`);
    if (/^instrumentation(-client)?\.(m?[jt]s|[jt]sx)$/.test(n)) problems.push(`${n} (runs inside the server)`);
    if (n === "pages") problems.push("pages/ (this app uses app/ only)");
  }
  for (const n of list(path.join(root, "src"))) if (/^instrumentation/.test(n) || n === "pages") problems.push(`src/${n}`);
  try { if (/node[-_]options/i.test(fs.readFileSync(path.join(root, ".npmrc"), "utf-8"))) problems.push(".npmrc sets node-options"); } catch { /* no .npmrc */ }
  if (/(^|\s)(--import|--require|-r|--loader|--experimental-loader)(=|\s|$)/.test(env.NODE_OPTIONS || "")) problems.push("NODE_OPTIONS loads code");
  return problems;
}

const problems = hookGuard(path.dirname(fileURLToPath(import.meta.url)));
if (problems.length) throw new Error(`Refusing to run: ${problems.join("; ")}. Remove it (or ask Roy), then start again.`);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local-only single-user dashboard; no image optimization or external hosts.
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // Next's dev/runtime scripts need inline/eval; the value that matters here is frame-ancestors (clickjacking of Approve/Deploy)
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=()" },
      ],
    }];
  },
};

export default nextConfig;
