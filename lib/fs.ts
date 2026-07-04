import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  VAULT,
  TREE_IGNORE,
  TREE_MAX_DEPTH,
  TREE_MAX_ENTRIES,
} from "./config";
import type { TreeNode } from "./types";

/**
 * READ-ONLY filesystem access to the RoyOS vault.
 * Nothing in this module ever writes, moves, or deletes.
 */

/** Read a UTF-8 file, returning null if it does not exist / cannot be read. */
export async function readTextSafe(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/** Read + JSON.parse a file, returning `fallback` on any error. */
export async function readJsonSafe<T>(file: string, fallback: T): Promise<T> {
  const raw = await readTextSafe(file);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** mtime as ISO string, or null. */
export async function mtimeIso(file: string): Promise<string | null> {
  try {
    const st = await fsp.stat(file);
    return st.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Resolve a vault-relative path to an absolute one, guaranteeing the result
 * stays INSIDE the vault. Returns null on any traversal attempt (../.. etc).
 * This is the security boundary for the file-preview route.
 */
export function resolveInVault(relPath: string): string | null {
  const normalized = path
    .normalize(relPath)
    .replace(/^([/\\])+/, ""); // strip leading slashes so it can't be absolute
  const full = path.resolve(VAULT, normalized);
  const vaultRoot = path.resolve(VAULT);
  if (full !== vaultRoot && !full.startsWith(vaultRoot + path.sep)) {
    return null;
  }
  return full;
}

interface WalkCtx {
  count: number;
  files: number;
  dirs: number;
}

/**
 * Recursively build a tree of the vault, sorted dirs-first then alphabetically.
 * Ignores dotfiles/known noise dirs and is bounded by depth + entry caps so it
 * can never runaway on a huge or looping tree.
 */
export async function buildTree(): Promise<{
  root: TreeNode;
  fileCount: number;
  dirCount: number;
}> {
  const vaultRoot = path.resolve(VAULT);
  const ctx: WalkCtx = { count: 0, files: 0, dirs: 0 };

  async function walk(absDir: string, depth: number): Promise<TreeNode[]> {
    if (depth > TREE_MAX_DEPTH || ctx.count > TREE_MAX_ENTRIES) return [];

    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: TreeNode[] = [];
    for (const d of dirents) {
      if (d.name.startsWith(".") || TREE_IGNORE.has(d.name)) continue;
      if (ctx.count > TREE_MAX_ENTRIES) break;
      ctx.count++;

      const abs = path.join(absDir, d.name);
      const rel = path.relative(vaultRoot, abs);

      if (d.isDirectory()) {
        ctx.dirs++;
        const children = await walk(abs, depth + 1);
        nodes.push({
          name: d.name,
          path: rel,
          type: "dir",
          size: 0,
          mtime: null,
          children,
          truncated: ctx.count > TREE_MAX_ENTRIES,
        });
      } else if (d.isFile()) {
        ctx.files++;
        let size = 0;
        let mtime: string | null = null;
        try {
          const st = await fsp.stat(abs);
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch {
          /* ignore stat errors */
        }
        nodes.push({
          name: d.name,
          path: rel,
          type: "file",
          size,
          mtime,
          ext: path.extname(d.name).replace(/^\./, "").toLowerCase(),
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return nodes;
  }

  const children = await walk(vaultRoot, 0);
  const root: TreeNode = {
    name: path.basename(vaultRoot) || "vault",
    path: "",
    type: "dir",
    size: 0,
    mtime: null,
    children,
  };
  return { root, fileCount: ctx.files, dirCount: ctx.dirs };
}
