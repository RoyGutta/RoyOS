# RoyOS — Control Center

A **local-first, read-only** dashboard that visualizes the RoyOS autonomous agent
in real time: an AI system running on your machine that continuously modifies its
own workspace (the Obsidian vault).

It reads the same files `08 AI/Agents/orchestrator.js` writes — and **never writes,
moves, or deletes anything**. It also asks Ollama directly which model is loaded.

> This dashboard lives **outside** the vault on purpose, so its own `node_modules`
> never pollute the agent's file tree or Obsidian index.

---

## What it shows

| Panel | Source | What you see |
|-------|--------|--------------|
| **System Status** | `state.json` + Ollama | Loop running/stopped (heartbeat from `state.lastRun`), last cycle age, active model, tasks logged, files seen |
| **Execution Feed** | `execution-log.jsonl` (+ `.md` mirror) | Live tail of every file the agent writes — timestamp, path, click a row to see full content |
| **Model Activity** | Ollama `/api/ps` + `/api/tags` | Which model is resident in memory *right now*, the goal→model router, all installed models |
| **Memory** | `memory.json` (+ `memory.md`) | Parsed insights, latest insight, and a growth-over-time sparkline |
| **Vault Explorer** | recursive walk of the vault | Expandable folder tree; click any file for a live preview that refreshes as the agent rewrites it |

Every panel polls its API route on a short interval, so the whole thing is "live"
without a database, websockets, or any cloud service.

---

## How the data actually maps (important)

The dashboard was built against the **real** RoyOS files, not assumptions:

- The orchestrator writes the live execution log to **`09 Logs/execution-log.jsonl`**
  (JSONL, one `{ "time", "task" }` per line). `execution-log.md` is a human mirror.
  The dashboard reads **both** and merges them.
- **Heartbeat**: there is no separate PID/heartbeat file. `saveState()` bumps
  `state.lastRun` every cycle, so "running" = `lastRun` newer than
  `ROYOS_HEARTBEAT_SECONDS` (default 45s; the loop idles up to 20s).
- **Active model** is *not* persisted to disk — the orchestrator only `console.log`s
  it. So the dashboard queries **Ollama** (`/api/ps`) for the truly-loaded model.
- `memory.json` is `{ "log": ["<ISO> <text>", …] }`; `memory.md` mirrors it.

---

## Setup

Requires **Node.js 18.18+** (Node 20+ recommended).

```bash
cd /Users/roygutta/Documents/royos-dashboard

# 1. install deps
npm install

# 2. point it at your vault (defaults are already correct for this machine)
cp .env.local.example .env.local
#   edit .env.local only if your vault path or Ollama host differ
```

`.env.local`:

```env
ROYOS_VAULT=/Users/roygutta/Documents/RoyOS
OLLAMA_HOST=http://localhost:11434
ROYOS_HEARTBEAT_SECONDS=45
```

## Run

```bash
# development (hot reload)
npm run dev
# → open http://localhost:4318

# production
npm run build
npm start
# → http://localhost:4318
```

That's it. Start `orchestrator.js` (and `ollama serve`) in another terminal and
watch the feed light up as the agent writes to the vault.

---

## API routes (all read-only, all `no-store`)

| Method | Route | Returns |
|--------|-------|---------|
| GET | `/api/state` | Parsed `state.json` + derived running/heartbeat |
| GET | `/api/memory` | Parsed `memory.json` (+ `.md`) with growth buckets |
| GET | `/api/logs` | `execution-log.jsonl` + `.md` merged into structured events |
| GET | `/api/tree` | Recursive vault file tree (bounded, ignores `.obsidian`/`.git`/`node_modules`) |
| GET | `/api/models` | Live Ollama status: loaded + installed models |
| GET | `/api/file?path=<rel>` | Text preview of one vault file (path-traversal is rejected) |

---

## Design notes

- **Stack**: Next.js (App Router) · React 19 · TailwindCSS v4 · Node route handlers. No backend, no DB, no auth.
- **Safety**: the file tree is depth- and entry-capped; `/api/file` refuses any
  path that resolves outside the vault; nothing ever opens a file for writing.
- **Aesthetic**: a dark "mission-control" console — monospace-forward, phosphor-teal
  signal, a heartbeat pulse and carrier sweep that only animate while the loop is alive.
  Respects `prefers-reduced-motion`.

## Continuous Mode and hosted mode

`/continuous` (also embedded on `/system`) shows the Jarvis supervisor exactly as the Mac last reported it and offers
on/off, pause, resume and stop. The contract is `~/Developer/Jarvis/docs/JARVIS-LINK-PROTOCOL.md` (v1.1); the Mac is
the source of truth, the dashboard never decides state, and a report older than 60 s renders as OFFLINE/UNKNOWN.

**Local mode (default).** Sign in at `/login` with the passphrase from `supervisor.py dashboard-passcode`. Keys come
from `~/Library/Application Support/Jarvis/link.json` (0600, created by `supervisor.py link-keys`; a broader mode is
refused). Status runs `supervisor.py link-status`, commands go through `supervisor.py link-apply` (channel `local`).
The server answers only on `127.0.0.1:4318` / `localhost:4318` (`DASHBOARD_PORT` moves the port). Sessions, lockouts and
command results live in a file store under the OS temp dir (`RELAY_FILE_DIR` overrides).

**Hosted mode (`JARVIS_HOSTED=1`, e.g. Vercel).** The same build serves ONLY `/login`, `/logout`, `/continuous`,
`/api/auth/*`, `/api/continuous/*` and the relay routes `/api/link/{report,commands,ack}`; every other page and API of
the local dashboard is 404 there, so no local path, file, transcript or secret can be read through it. Login is
passphrase + authenticator code (TOTP), the cookie is `__Host-` / Secure, and all shared state (rate limits, Mac nonces,
sessions, pending commands, acks, the snapshot) lives in ONE durable store. With no store configured the app answers 503
everywhere — it never falls back to memory.

Environment variables (names only; values come from `supervisor.py link-keys --vercel`, never from a terminal):

| Name | Meaning |
|------|---------|
| `JARVIS_HOSTED` | `1` turns on the hosted lockdown |
| `RELAY_STORE` | `upstash` (default when hosted) or `file` (loopback staging only, needs `RELAY_STAGING=1`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | the Redis-compatible REST store (Upstash; Vercel Marketplace provides both) |
| `LINK_INSTALL_ID` | the Mac's `INSTALL_ID` (16 hex, not secret) |
| `LINK_KEY` | transport MAC for Mac↔relay requests |
| `CMD_KEY` | MAC on every command (server signs, Mac verifies) |
| `DASHBOARD_PASS_HASH` | `scrypt$N$r$p$salt$hash` from `supervisor.py dashboard-passcode` |
| `TOTP_SECRET` | base32 authenticator secret enrolled by `dashboard-passcode` |
| `SESSION_KEY` | signs the session cookie |
| `RELAY_STAGING`, `RELAY_FILE_DIR` | staging/tests only |

Tests: `npm test` (Node's own runner over the TypeScript sources). Hosted end-to-end on loopback with the file store,
after `npm run build`: `npm run test:e2e-hosted` (starts a production server on a free port, plays browser and Mac,
stops it; prints statuses only).

## Project layout

```
royos-dashboard/
├─ app/
│  ├─ layout.tsx · page.tsx · globals.css
│  └─ api/{state,memory,logs,tree,models,file}/route.ts
├─ components/
│  ├─ SystemStatus.tsx · TaskFeed.tsx · ModelStatus.tsx
│  ├─ MemoryPanel.tsx · FileTree.tsx · usePolling.ts
└─ lib/
   ├─ config.ts   # VAULT path + all file locations (the one place to change)
   ├─ types.ts    # shared client/server types
   ├─ fs.ts       # read-only vault access + bounded tree walk
   └─ parser.ts   # pure parsers for logs / memory / state
```
