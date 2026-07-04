"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling, fmtBytes, timeAgo } from "./usePolling";
import type { TreePayload, TreeNode, FilePayload } from "@/lib/types";

function fileGlyph(ext?: string): string {
  switch (ext) {
    case "md":
      return "≡";
    case "json":
    case "jsonl":
      return "{}";
    case "js":
    case "ts":
    case "tsx":
    case "mjs":
      return "<>";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "excalidraw":
      return "▨";
    default:
      return "·";
  }
}

function Row({
  node,
  depth,
  expanded,
  toggle,
  selected,
  select,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (p: string) => void;
  selected: string | null;
  select: (n: TreeNode) => void;
}) {
  const pad = { paddingLeft: `${8 + depth * 14}px` };

  if (node.type === "dir") {
    const isOpen = expanded.has(node.path);
    const count = node.children?.length ?? 0;
    return (
      <li>
        <button
          onClick={() => toggle(node.path)}
          className="w-full text-left py-1.5 pr-3 flex items-center gap-2 hover-line"
          style={pad}
        >
          <span className="text-muted w-3 shrink-0">{isOpen ? "▾" : "▸"}</span>
          <span className="text-active shrink-0">▚</span>
          <span className="text-ink truncate">{node.name}</span>
          <span className="text-muted text-[10.5px] ml-auto shrink-0">{count}</span>
        </button>
        {isOpen && node.children && (
          <ul>
            {node.children.map((c) => (
              <Row
                key={c.path}
                node={c}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
                select={select}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const active = selected === node.path;
  return (
    <li>
      <button
        onClick={() => select(node)}
        className={`w-full text-left py-1.5 pr-3 flex items-center gap-2 hover-line ${
          active ? "bg-[rgba(77,216,192,0.10)]" : ""
        }`}
        style={pad}
      >
        <span className="w-3 shrink-0" />
        <span className="text-muted shrink-0 w-4 text-center">{fileGlyph(node.ext)}</span>
        <span className={`truncate ${active ? "text-accent" : "text-dim"}`}>
          {node.name}
        </span>
        <span className="text-muted text-[10.5px] ml-auto shrink-0">
          {fmtBytes(node.size)}
        </span>
      </button>
    </li>
  );
}

export default function FileTree() {
  const { data } = usePolling<TreePayload>("/api/tree", 8000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const seeded = useRef(false);

  // On first load, open the agent-relevant folders so the tree is useful immediately.
  useEffect(() => {
    if (seeded.current || !data) return;
    seeded.current = true;
    const open = new Set<string>();
    for (const c of data.root.children ?? []) {
      if (/^(08 AI|09 Logs)/.test(c.name)) open.add(c.path);
    }
    setExpanded(open);
  }, [data]);

  const toggle = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }, []);

  const loadPreview = useCallback(async (path: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
        cache: "no-store",
      });
      setPreview((await res.json()) as FilePayload);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const select = useCallback(
    (n: TreeNode) => {
      setSelected(n.path);
      loadPreview(n.path);
    },
    [loadPreview],
  );

  // Keep the open file fresh — the agent may rewrite it under us.
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => loadPreview(selected), 5000);
    return () => clearInterval(id);
  }, [selected, loadPreview]);

  return (
    <section className="panel flex flex-col min-h-0">
      <div className="panel__head">
        <span className="dot dot--active" aria-hidden />
        <span className="eyebrow">Vault Explorer</span>
        <span className="text-muted text-[11px] truncate">{data?.vault ?? ""}</span>
        <span className="ml-auto chip">
          {data ? `${data.fileCount} files · ${data.dirCount} dirs` : "…"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,340px)_1fr] min-h-0 flex-1">
        {/* tree */}
        <ul className="overflow-auto border-b md:border-b-0 md:border-r border-line py-1 min-h-[220px] max-h-[520px]">
          {data?.root.children?.map((c) => (
            <Row
              key={c.path}
              node={c}
              depth={0}
              expanded={expanded}
              toggle={toggle}
              selected={selected}
              select={select}
            />
          ))}
          {!data && <li className="px-4 py-6 text-muted">Reading vault…</li>}
        </ul>

        {/* preview */}
        <div className="flex flex-col min-h-0 max-h-[520px]">
          {selected ? (
            <>
              <div className="px-4 py-2 border-b border-line flex items-center gap-3">
                <span className="text-accent text-[12px] truncate flex-1">{selected}</span>
                {preview && (
                  <span className="text-muted text-[11px] shrink-0">
                    {fmtBytes(preview.size)} · {timeAgo(preview.mtime)}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {previewLoading && !preview ? (
                  <div className="p-6 text-muted">Loading…</div>
                ) : preview?.binary ? (
                  <div className="p-6 text-muted">
                    Binary file ({fmtBytes(preview.size)}) — no text preview.
                  </div>
                ) : (
                  <pre className="p-4 text-[12px] text-dim whitespace-pre-wrap break-words leading-relaxed">
                    {preview?.content}
                    {preview?.truncated && (
                      <span className="block mt-3 text-active">
                        … truncated (file larger than preview limit)
                      </span>
                    )}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted text-center p-8">
              Select a file to preview its contents.
              <br />
              The view refreshes as the agent rewrites it.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
