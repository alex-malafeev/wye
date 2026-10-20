// Wye as a MemoryBench provider (plan:memorybench, decision:waterfall.memorybench-measures-retrieval-first).
// Everything goes through the wye CLI against a scratch app (WYE_URL, never the live app on 3456):
//   ingest        a new vault per container — `wye init <folder> --slug <slug>` — and each session written as a dated
//                 markdown page, brought in with `wye import <dir> --product <slug> --no-analyse`
//   awaitIndexing `wye ask-search` until the last session's page comes back (the Ask index is built on first search)
//   search        `wye ask-search <q> --product <slug> --source doc --rerank --limit n --json`: Wye's full-text +
//                 vector search over the session pages, reranked by its cross-encoder; no language model
//   clear         the vault's folder and its registration removed
// Copied into a MemoryBench checkout as src/providers/wye by `wye eval public memorybench --fetch`.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Provider, ProviderConfig, IngestOptions, IngestResult, SearchOptions, IndexingProgressCallback } from "../../types/provider"
import type { UnifiedSession } from "../../types/unified"
import { logger } from "../../utils/logger"
import { WYE_PROMPTS, type WyeHit } from "./prompts"

const BENCH = process.env.WYE_BENCH_DIR || join(homedir(), "wye-bench")
const VAULTS = join(BENCH, "vaults")
const WYE = process.env.WYE_BIN || "wye"

function wye(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(WYE, args, { cwd: cwd || BENCH, env: process.env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`wye ${args.slice(0, 2).join(" ")}: ${(stderr || err.message).trim().slice(0, 400)}`))
      else resolve(stdout)
    })
  })
}

// a product slug for a container tag: readable, short, unique
export function slugOf(containerTag: string): string {
  const h = createHash("sha1").update(containerTag).digest("hex").slice(0, 8)
  const base = containerTag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28).replace(/-+$/, "")
  return `mb-${base}-${h}`
}

// one session as a page: its title carries the session id and the date, so a hit names both
export function sessionPage(s: UnifiedSession): { title: string; md: string } {
  const date = (s.metadata?.formattedDate as string) || (s.metadata?.date as string) || ""
  const title = `${s.sessionId}${date ? ` · ${date}` : ""}`
  const lines = s.messages.map((m) => {
    const who = m.speaker || m.role
    const at = m.timestamp ? ` (${m.timestamp})` : ""
    return `**${who}${at}:** ${m.content.replace(/\r/g, "").trim()}`
  })
  const md = `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n${date ? `Date: ${date}\n\n` : ""}${lines.join("\n\n")}\n`
  return { title, md }
}

export class WyeProvider implements Provider {
  name = "wye"
  prompts = WYE_PROMPTS
  // sessions of one container are imported one at a time (one vault, one build); searches can overlap
  concurrency = { default: 4, ingest: 1, indexing: 2, search: 4 }
  private known = new Set<string>()

  async initialize(_config: ProviderConfig): Promise<void> {
    const url = process.env.WYE_URL || ""
    if (!url || /:3456\b/.test(url)) throw new Error("WYE_URL must name the scratch Wye app (wye eval public memorybench --run starts one), never the live app on 3456")
    if (!process.env.WYE_PORT || process.env.WYE_PORT === "3456") throw new Error("WYE_PORT must be the scratch app's port, so no wye command reaches the live app")
    const r = await fetch(`${url}/api/products`).catch(() => null)
    if (!r || !r.ok) throw new Error(`no Wye app answers at ${url}`)
    mkdirSync(VAULTS, { recursive: true })
    logger.info(`Wye provider: app ${url}, vaults under ${VAULTS}`)
  }

  private async ensureVault(containerTag: string): Promise<string> {
    const slug = slugOf(containerTag)
    if (this.known.has(slug)) return slug
    const folder = join(VAULTS, slug)
    if (!existsSync(join(folder, ".wye", "_product.md"))) {
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, "container.txt"), containerTag + "\n")
      await wye(["init", ".", "--slug", slug, "--title", `MemoryBench ${containerTag}`.slice(0, 80)], folder)
    }
    this.known.add(slug)
    return slug
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const slug = await this.ensureVault(options.containerTag)
    const dir = mkdtempSync(join(BENCH, "import-"))
    try {
      sessions.forEach((s, i) => writeFileSync(join(dir, `${String(i).padStart(3, "0")}-${s.sessionId.replace(/[^A-Za-z0-9_-]+/g, "-")}.md`), sessionPage(s).md))
      await wye(["import", dir, "--product", slug, "--no-analyse"])
    } finally { rmSync(dir, { recursive: true, force: true }) }
    const ids = sessions.map((s) => s.sessionId)
    // the last session's first words: awaitIndexing searches for them
    const last = sessions[sessions.length - 1]
    const probe = last ? (last.messages.find((m) => m.content.trim().length > 20)?.content || last.messages[0]?.content || "") : ""
    const file = join(VAULTS, slug, "probe.json")
    writeFileSync(file, JSON.stringify({ sessionId: last?.sessionId, probe: probe.slice(0, 160) }))
    return { documentIds: ids }
  }

  async awaitIndexing(result: IngestResult, containerTag: string, onProgress?: IndexingProgressCallback): Promise<void> {
    const slug = slugOf(containerTag)
    let p: { sessionId?: string; probe?: string } = {}
    try { p = JSON.parse(readFileSync(join(VAULTS, slug, "probe.json"), "utf8")) } catch { /* nothing ingested */ }
    const deadline = Date.now() + 15 * 60_000
    while (p.sessionId && p.probe && Date.now() < deadline) {
      const hits = await this.hits(p.probe, slug, 30).catch(() => [] as WyeHit[])
      if (hits.some((h) => h.sessionId === p.sessionId)) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    onProgress?.({ completedIds: result.documentIds, failedIds: [], total: result.documentIds.length })
  }

  private async hits(query: string, slug: string, limit: number): Promise<WyeHit[]> {
    const out = await wye(["ask-search", query.slice(0, 1000), "--product", slug, "--source", "doc", "--rerank", "--limit", String(Math.min(60, limit)), "--json"])
    const j = JSON.parse(out) as { hits: { title: string; text: string; score: number; ref: string }[] }
    return (j.hits || []).map((h) => {
      const page = h.title.split(" › ")[0].replace(/^"(.*)"$/, "$1")
      const [sessionId, date] = page.split(" · ")
      return { content: h.text, sessionId, date: date || undefined, score: h.score, ref: h.ref }
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    return this.hits(query, slugOf(options.containerTag), options.limit ?? 10)
  }

  async clear(containerTag: string): Promise<void> {
    const slug = slugOf(containerTag)
    rmSync(join(VAULTS, slug), { recursive: true, force: true })
    const home = process.env.WYE_HOME
    if (home) rmSync(join(home, "data", "products", slug), { recursive: true, force: true })
    this.known.delete(slug)
  }
}

export default WyeProvider
