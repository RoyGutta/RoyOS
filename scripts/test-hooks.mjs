// Resolver hooks so `node --test` can load the dashboard's TypeScript directly (Node 24 strips types):
//   - "@/x" → <repo>/x            (tsconfig paths alias)
//   - "./x" without an extension → ./x.ts | .tsx | .js | ./x/index.ts
//   - "next/server" and friends  → their ".js" entry (no exports map for bare subpaths under plain Node)
// Usage: node --import ./scripts/test-hooks.mjs --test "tests/**/*.test.ts"
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// R13-1: only under the test runner may lib/jarvis/runs.ts follow JARVIS_DIR / JARVIS_VOICE_LINE to a scratch folder
globalThis.__ROYOS_TEST_PATHS__ = true;
const EXT = [".ts", ".tsx", ".mts", ".js", ".mjs"];
const NEXT_SUBPATHS = new Set(["next/server", "next/headers", "next/navigation"]);

function withExt(abs) {
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  for (const e of EXT) if (existsSync(abs + e)) return abs + e;
  for (const e of EXT) { const idx = path.join(abs, "index" + e); if (existsSync(idx)) return idx; }
  return null;
}

// Only the repo's own ESM TypeScript is rewritten; anything requested from inside node_modules (Next's CJS internals)
// passes through untouched, since the CJS loader does not accept file: URLs.
function ownParent(context) {
  const p = context.parentURL;
  return typeof p === "string" && p.startsWith("file:") && !p.includes("/node_modules/");
}

registerHooks({
  resolve(specifier, context, next) {
    if (NEXT_SUBPATHS.has(specifier) && ownParent(context)) return next(specifier + ".js", context);
    if (specifier.startsWith("@/") && ownParent(context)) {
      const abs = withExt(path.join(ROOT, specifier.slice(2)));
      if (abs) return next(pathToFileURL(abs).href, context);
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && ownParent(context)) {
      const abs = withExt(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (abs && !abs.includes(`${path.sep}node_modules${path.sep}`)) return next(pathToFileURL(abs).href, context);
    }
    return next(specifier, context);
  },
});
