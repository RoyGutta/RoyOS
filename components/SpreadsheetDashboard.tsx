"use client";

import { useMemo, useState } from "react";
import { usePolling } from "./usePolling";

/** Interactive dashboard over an ingested dataset (projects/spreadsheet-dashboard). Everything below is computed
 *  client-side from dashboard-data.json: filters drive the cards, charts and table. Charts are inline SVG with a
 *  text summary for screen readers. Nothing here invents data: refused suggestions and assumptions are shown. */
interface Col { name: string; type: string; null_count: number; distinct_count: number; examples: string[]; sensitive: boolean; min: string | number | null; max: string | number | null }
interface Plan { metric_cards: { id: string; label: string; aggregate: string; column: string | null; reason: string }[]; time_series: { x: string; y: string; aggregate: string; bucket: string; reason: string }[];
  category_comparisons: { group_by: string; measure: string | null; aggregate: string; reason: string }[]; distributions: { column: string; kind: string; reason: string }[];
  filters: { column: string; kind: string; reason: string }[]; table_columns: { name: string; type: string; sensitive: boolean }[]; refused: { column: string; action: string; reason: string }[]; warnings: string[]; assumptions: string[] }
interface Data { sourceFile: string; sourceHash: string; importedAt: string; reader: { format: string; encoding?: string; formula_cells?: number }; profile: { row_count: number; valid_row_count: number; column_count: number; duplicate_row_count: number; invalid_rows: { count: number; reasons: Record<string, number> }; columns: Col[]; formula_like_strings?: number | { total: number; by_column?: Record<string, number> }; large_number_columns?: string[]; mixed_type_columns?: string[]; warnings?: string[] };
  plan: Plan; columns: string[]; rows: string[][]; rowCount: number; truncated: boolean; transformations: { kind: string; count: number; how: string }[]; warnings: string[] }
interface List { datasets: { name: string; importedAt?: string; rows?: number; source?: string; warnings?: number }[]; providers: Record<string, string> }

const num = (v: string) => { const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) && String(v).trim() !== "" ? n : null; };
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const safeCsv = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v);

function agg(vals: number[], how: string) {
  if (!vals.length) return null;
  if (how === "count") return vals.length;
  const s = vals.reduce((a, b) => a + b, 0);
  return how === "sum" ? s : how === "avg" || how === "average" || how === "mean" ? s / vals.length : how === "min" ? Math.min(...vals) : how === "max" ? Math.max(...vals) : s;
}

function bucket(iso: string, how: string) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
  if (how === "month") return iso.slice(0, 7);
  if (how === "week") { const day = (d.getUTCDay() + 6) % 7; const m = new Date(d); m.setUTCDate(d.getUTCDate() - day); return m.toISOString().slice(0, 10); }
  return iso.slice(0, 10);
}

function Chart({ title, desc, points, kind }: { title: string; desc: string; points: { label: string; value: number }[]; kind: "line" | "bar" }) {
  const W = 560, H = 220, L = 48, B = 36, T = 14, R = 12;
  if (!points.length) return <section className="panel"><div className="panel__head"><span className="eyebrow">{title}</span></div><div className="px-4 py-3 text-muted text-[12px]">No rows match the current filters.</div></section>;
  const max = Math.max(...points.map((p) => p.value), 0) || 1;
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const bw = Math.max(4, (W - L - R) / points.length - 4);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => ({ v: max * f, y: y(max * f) }));
  const summary = `${points.length} points; highest ${fmt(max)} at ${points.find((p) => p.value === max)?.label}; lowest ${fmt(Math.min(...points.map((p) => p.value)))}.`;
  return (
    <section className="panel">
      <div className="panel__head"><span className="eyebrow">{title}</span><span className="text-muted text-[11px] truncate" title={desc}>{desc}</span></div>
      <div className="px-3 py-2">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`t-${title.replace(/\W/g, "")}`} className="w-full h-auto" style={{ maxHeight: 260 }}>
          <title id={`t-${title.replace(/\W/g, "")}`}>{title}. {summary}</title>
          {ticks.map((t) => <g key={t.v}><line x1={L} x2={W - R} y1={t.y} y2={t.y} stroke="var(--color-line)" /><text x={L - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="var(--color-dim)">{fmt(t.v)}</text></g>)}
          {kind === "bar" ? points.map((p, i) => <rect key={p.label} x={L + (i * (W - L - R)) / points.length + 2} y={y(p.value)} width={bw} height={H - B - y(p.value)} fill="var(--color-accent)" opacity="0.85"><title>{p.label}: {fmt(p.value)}</title></rect>)
            : <polyline fill="none" stroke="var(--color-accent)" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />}
          {kind === "line" && points.map((p, i) => <circle key={p.label} cx={x(i)} cy={y(p.value)} r="3" fill="var(--color-accent)"><title>{p.label}: {fmt(p.value)}</title></circle>)}
          {points.map((p, i) => (i % Math.ceil(points.length / 8) === 0 || points.length <= 8) && <text key={`l${p.label}`} x={kind === "bar" ? L + (i * (W - L - R)) / points.length + bw / 2 + 2 : x(i)} y={H - B + 14} textAnchor="middle" fontSize="10" fill="var(--color-dim)">{p.label.slice(0, 12)}</text>)}
        </svg>
        <p className="sr-only">{summary}</p>
      </div>
    </section>
  );
}

export default function SpreadsheetDashboard() {
  const list = usePolling<List>("/api/dashboards", 15000);
  const [name, setName] = useState<string>("");
  const chosen = name || list.data?.datasets[0]?.name || "";
  const ds = usePolling<Data | { error: string }>(`/api/dashboards?name=${encodeURIComponent(chosen || "none")}`, 60000);
  const data = ds.data && !("error" in ds.data) ? ds.data : null;
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [range, setRange] = useState<{ col: string; from: string; to: string }>({ col: "", from: "", to: "" });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [upload, setUpload] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cols = data?.columns ?? [];
  const idx = (c: string) => cols.indexOf(c);
  const rows = useMemo(() => {
    if (!data) return [] as string[][];
    let r = data.rows;
    for (const [c, vals] of Object.entries(sel)) if (vals.length) { const i = idx(c); r = r.filter((row) => vals.includes(row[i])); }
    if (range.col) { const i = idx(range.col); r = r.filter((row) => (!range.from || row[i] >= range.from) && (!range.to || row[i] <= range.to)); }
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter((row) => row.some((v) => String(v).toLowerCase().includes(s))); }
    if (sort) r = [...r].sort((a, b) => { const na = num(a[sort.col]), nb = num(b[sort.col]); const cmp = na !== null && nb !== null ? na - nb : String(a[sort.col]).localeCompare(String(b[sort.col])); return cmp * sort.dir; });
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sel, range, q, sort]);

  async function doUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setUpload(null);
    const fd = new FormData(e.currentTarget);
    const r = await fetch("/api/dashboards", { method: "POST", body: fd });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; name?: string; log?: string; error?: string };
    setBusy(false); setUpload(`HTTP ${r.status} · ${j.error ?? j.log ?? ""}`.slice(0, 600));
    if (j.ok && j.name) { setName(j.name); list.refresh(); }
  }
  function downloadCsv() {
    const lines = [cols.map(safeCsv).join(","), ...rows.map((r) => r.map((v) => `"${safeCsv(String(v)).replace(/"/g, '""')}"`).join(","))];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = `${chosen}-filtered.csv`; a.click();
  }
  const pageRows = rows.slice(page * 50, page * 50 + 50);
  const fl = data?.profile.formula_like_strings;
  const formulaLike = typeof fl === "number" ? fl : fl?.total ?? 0;
  const dateCols = data?.profile.columns.filter((c) => c.type === "date" || c.type === "datetime").map((c) => c.name) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel__head"><span className="eyebrow">Spreadsheet dashboard</span><span className="text-muted text-[11px]">local files only · Google Sheets: {list.data?.providers.googleSheets ?? "—"} · local: {list.data?.providers.local ?? "—"}</span></div>
        <div className="px-4 py-3 grid gap-3 md:grid-cols-2 text-[12px]">
          <div>
            <label className="eyebrow block mb-1" htmlFor="ds">Dataset</label>
            <select id="ds" className="input" value={chosen} onChange={(e) => { setName(e.target.value); setSel({}); setRange({ col: "", from: "", to: "" }); setQ(""); setPage(0); }}>
              {(list.data?.datasets ?? []).map((d) => <option key={d.name} value={d.name}>{d.name} — {d.rows ?? "?"} rows · {d.source ?? ""}</option>)}
            </select>
            {list.error && <div className="text-offline mt-1" role="status">{list.error}</div>}
            {list.data && list.data.datasets.length === 0 && <div className="text-muted mt-1">No datasets yet. Upload a CSV or XLSX, or run <code>python cli.py ingest fixtures/sales.csv --out output/sales</code> in projects/spreadsheet-dashboard.</div>}
          </div>
          <form onSubmit={doUpload} className="flex flex-col gap-1">
            <label className="eyebrow" htmlFor="file">Upload CSV / XLSX (treated as untrusted; macros refused, formulas never evaluated)</label>
            <div className="flex gap-2 items-center"><input id="file" name="file" type="file" accept=".csv,.tsv,.txt,.xlsx" className="input" required /><button className="btn btn--primary" disabled={busy}>{busy ? "Importing…" : "Import"}</button></div>
            {upload && <div className="text-[11px] text-muted" role="status">{upload}</div>}
          </form>
        </div>
      </section>

      {ds.loading && !data && <div className="text-muted text-[12px]">loading dataset…</div>}
      {ds.data && "error" in ds.data && <div className="text-offline text-[12px]" role="alert">{ds.data.error}</div>}
      {data && (<>
        <section className="panel">
          <div className="panel__head"><span className="eyebrow">{data.sourceFile}</span><span className="text-muted text-[11px]">data last refreshed {data.importedAt} · sha256 {data.sourceHash.slice(0, 12)} · {data.reader.format}{data.reader.encoding ? ` ${data.reader.encoding}` : ""}{data.truncated ? " · showing the first 5,000 rows" : ""}</span></div>
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-[12px]">
            {data.plan.metric_cards.map((m) => { const vals = m.column ? rows.map((r) => num(r[idx(m.column!)])).filter((v): v is number => v !== null) : rows.map(() => 1); const v = agg(vals, m.aggregate); return (
              <div key={m.id} title={m.reason}><div className="kpi">{v === null ? "—" : fmt(v)}</div><div className="text-muted">{m.label}</div><div className="text-muted text-[10.5px]">{m.aggregate}{m.column ? ` of ${m.column}` : ""}</div></div>); })}
          </div>
          <div className="px-4 pb-3 flex flex-wrap gap-2 text-[11px]">
            <span className={`badge ${data.profile.duplicate_row_count ? "badge--warn" : "badge--ok"}`}>{data.profile.duplicate_row_count} duplicate rows</span>
            <span className={`badge ${data.profile.invalid_rows.count ? "badge--bad" : "badge--ok"}`}>{data.profile.invalid_rows.count} invalid rows</span>
            <span className={`badge ${formulaLike ? "badge--warn" : ""}`}>{formulaLike} formula-like cells</span>
            <span className="badge">{(data.profile.large_number_columns ?? []).length} large-number columns</span>
            <span className="badge">{(data.profile.mixed_type_columns ?? []).length} mixed-type columns</span>
            <span className="badge">{data.profile.columns.filter((c) => c.sensitive).length} sensitive columns (examples redacted)</span>
            <details className="w-full"><summary className="cursor-pointer text-muted">{data.warnings.length} warnings · {data.transformations.length} transformations · {data.plan.refused.length} refused chart suggestions · assumptions</summary>
              <ul className="mt-1 space-y-0.5">{data.warnings.map((w, i) => <li key={`w${i}`} className="text-warn">{w}</li>)}{data.transformations.map((t, i) => <li key={`t${i}`} className="text-muted">{t.kind}: {t.count} — {t.how}</li>)}{data.plan.refused.map((r, i) => <li key={`r${i}`} className="text-muted">refused {r.action} on {r.column}: {r.reason}</li>)}{data.plan.assumptions.map((a, i) => <li key={`a${i}`} className="text-muted">assumption: {a}</li>)}</ul></details>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head"><span className="eyebrow">Filters</span><span className="text-muted text-[11px]">{rows.length} of {data.rows.length} rows</span><span className="ml-auto flex gap-2"><button className="btn btn--sm" onClick={() => { setSel({}); setRange({ col: "", from: "", to: "" }); setQ(""); setPage(0); }}>Clear filters</button><button className="btn btn--sm" onClick={downloadCsv} disabled={!rows.length}>Download filtered CSV</button></span></div>
          <div className="px-4 py-3 grid gap-3 md:grid-cols-3 text-[12px]">
            {data.plan.filters.filter((f) => f.kind === "multi-select").map((f) => { const i = idx(f.column); const opts = [...new Set(data.rows.map((r) => r[i]))].sort(); return (
              <div key={f.column}><label className="eyebrow block mb-1" htmlFor={`f-${f.column}`}>{f.column}</label><select id={`f-${f.column}`} multiple className="input" size={Math.min(5, opts.length)} value={sel[f.column] ?? []} onChange={(e) => { setSel({ ...sel, [f.column]: [...e.target.selectedOptions].map((o) => o.value) }); setPage(0); }}>{opts.map((o) => <option key={o} value={o}>{o || "(empty)"}</option>)}</select></div>); })}
            {dateCols.length > 0 && <div><label className="eyebrow block mb-1" htmlFor="rc">Date range</label><div className="flex gap-1 flex-wrap"><select id="rc" className="input" value={range.col} onChange={(e) => setRange({ ...range, col: e.target.value })}><option value="">(column)</option>{dateCols.map((c) => <option key={c}>{c}</option>)}</select><input aria-label="from date" type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><input aria-label="to date" type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div></div>}
            <div><label className="eyebrow block mb-1" htmlFor="q">Search</label><input id="q" className="input" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="any column" /></div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {data.plan.time_series.slice(0, 2).map((ts) => { const m = new Map<string, number[]>(); for (const r of rows) { const b = bucket(r[idx(ts.x)], ts.bucket); const v = num(r[idx(ts.y)]); if (b && v !== null) m.set(b, [...(m.get(b) ?? []), v]); } const pts = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, vals]) => ({ label, value: agg(vals, ts.aggregate) ?? 0 })); return <Chart key={`${ts.x}${ts.y}`} kind="line" title={`${ts.aggregate} of ${ts.y} by ${ts.bucket}`} desc={ts.reason} points={pts} />; })}
          {data.plan.category_comparisons.slice(0, 2).map((cc) => { const m = new Map<string, number[]>(); for (const r of rows) { const k = r[idx(cc.group_by)] || "(empty)"; const v = cc.measure ? num(r[idx(cc.measure)]) : 1; if (v !== null) m.set(k, [...(m.get(k) ?? []), v]); } const pts = [...m.entries()].map(([label, vals]) => ({ label, value: agg(vals, cc.aggregate) ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 30); return <Chart key={cc.group_by + (cc.measure ?? "")} kind="bar" title={`${cc.aggregate}${cc.measure ? ` of ${cc.measure}` : ""} by ${cc.group_by}`} desc={cc.reason} points={pts} />; })}
          {data.plan.distributions.slice(0, 1).map((d) => { const vals = rows.map((r) => num(r[idx(d.column)])).filter((v): v is number => v !== null); if (!vals.length) return <Chart key={d.column} kind="bar" title={`distribution of ${d.column}`} desc={d.reason} points={[]} />; const lo = Math.min(...vals), hi = Math.max(...vals), bins = Math.min(12, Math.max(4, Math.round(Math.sqrt(vals.length)))), w = (hi - lo) / bins || 1; const counts = Array.from({ length: bins }, () => 0); for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++; return <Chart key={d.column} kind="bar" title={`distribution of ${d.column}`} desc={`${d.reason} · ${bins} bins`} points={counts.map((c, i) => ({ label: fmt(lo + i * w), value: c }))} />; })}
        </div>

        <section className="panel">
          <div className="panel__head"><span className="eyebrow">Rows</span><span className="text-muted text-[11px]">page {page + 1} of {Math.max(1, Math.ceil(rows.length / 50))}</span><span className="ml-auto flex gap-2"><button className="btn btn--sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Previous</button><button className="btn btn--sm" onClick={() => setPage(page + 1)} disabled={(page + 1) * 50 >= rows.length}>Next</button></span></div>
          <div className="px-2 py-2 overflow-auto">
            {rows.length === 0 ? <div className="text-muted text-[12px] px-2">No rows match the current filters.</div> : (
              <table className="table"><thead><tr>{cols.map((c, i) => <th key={c} aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button className="btn btn--sm" onClick={() => setSort(sort?.col === i ? { col: i, dir: sort.dir === 1 ? -1 : 1 } : { col: i, dir: 1 })}>{c}{sort?.col === i ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>)}</tr></thead>
                <tbody>{pageRows.map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} className={data.profile.columns[ci]?.sensitive ? "text-muted" : ""}>{v}</td>)}</tr>)}</tbody></table>)}
          </div>
        </section>
      </>)}
    </div>
  );
}
