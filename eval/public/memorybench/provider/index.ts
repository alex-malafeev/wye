// Wye as a MemoryBench provider (plan:memorybench, decision:waterfall.memorybench-measures-retrieval-first).
// Everything goes through the wye CLI against a scratch app (WYE_URL, never the live app on 3456):
//   ingest        a new vault per container — `wye init <folder> --slug <slug>` — and each session written as a dated
//                 markdown page into the container's stage folder
//   awaitIndexing `wye` (decision:waterfall.import-sets-up-the-graph-first): the stage imported in one `wye import`
//                 with analysis — an agent sets up the types and the recurring entities, then the pages become linked
//                 cards — and waited on until the import's page has every file checked off;
//                 `wye-pages`: the stage imported with --no-analyse, plain pages (what the graph adds is the difference)
//   search        `wye ask-search <q> --product <slug> --rerank [--expand] --limit n --json`: Wye's full-text + vector
//                 search, reranked by its cross-encoder, over the cards and the pages (`wye-pages`: the pages)
//   clear         the vault's folder and its registration removed
// Copied into a MemoryBench checkout as src/providers/wye by `wye eval public memorybench --fetch`.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Provider, ProviderConfig, IngestOptions, IngestResult, SearchOptions, IndexingProgressCallback } from "../../types/provider"
import type { UnifiedSession } from "../../types/unified"
import { logger } from "../../utils/logger"
import { WYE_PROMPTS, type WyeHit } from "./prompts"

const BENCH = process.env.WYE_BENCH_DIR || join(homedir(), "wye-bench")
const VAULTS = join(BENCH, "vaults")
const STAGE = join(BENCH, "stage")
// what the material is, as a person importing it would say — the same words for every benchmark, never tuned to its questions
const BRIEF = process.env.WYE_BENCH_BRIEF || "Dated conversation sessions."
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
  graph = true
  prompts = WYE_PROMPTS
  // sessions of one container are imported one at a time (one vault, one build); searches can overlap; answers and
  // judgements WYE_BENCH_ANSWERS at a time (default 10) — each answer is its own claude process
  concurrency = { default: 4, ingest: 1, indexing: 4, search: 4, answer: Number(process.env.WYE_BENCH_ANSWERS) || 10, evaluate: Number(process.env.WYE_BENCH_ANSWERS) || 10 }
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
    const dir = join(STAGE, slug); mkdirSync(dir, { recursive: true })
    for (const s of sessions) writeFileSync(join(dir, `${s.sessionId.replace(/[^A-Za-z0-9_-]+/g, "-")}.md`), sessionPage(s).md)
    return { documentIds: sessions.map((s) => s.sessionId) }
  }

  // the container's sessions go in as one import, once: its page is the record of what is done
  async awaitIndexing(result: IngestResult, containerTag: string, onProgress?: IndexingProgressCallback): Promise<void> {
    const slug = slugOf(containerTag)
    const docs = join(VAULTS, slug, ".wye", "projects", slug, "docs")
    const page = () => { try { return readdirSync(docs).filter((f) => /^import-/.test(f)).map((f) => readFileSync(join(docs, f), "utf8")).join("\n") } catch { return "" } }
    if (!page()) {
      const args = ["import", join(STAGE, slug), "--product", slug]
      if (this.graph) args.push("--brief", BRIEF); else args.push("--no-analyse")
      await wye(args)
    }
    const deadline = Date.now() + 4 * 60 * 60_000
    while (Date.now() < deadline) {
      const md = page()
      const total = (md.match(/^- \[[ x]\] task:import-\d+ /gm) || []).length, done = (md.match(/^- \[x\] task:import-\d+ /gm) || []).length
      if (!this.graph || (total && done === total)) break
      await this.resumeStopped(slug)
      await new Promise((r) => setTimeout(r, 10_000))
    }
    // the Ask index is built on the first search: one search, so the questions do not wait on it one by one
    await this.hits("warm up", slug, 5).catch(() => [])
    onProgress?.({ completedIds: result.documentIds, failedIds: [], total: result.documentIds.length })
  }

  // a restart of the app (its memory cap) ends the import it was running; the import page still lists the files left
  // and Resume goes on from the first one not done
  private async resumeStopped(slug: string): Promise<void> {
    const url = process.env.WYE_URL
    const r = await fetch(`${url}/api/${slug}/imports`).then((r) => (r.ok ? r.json() : null), () => null) as { batches: { requestSlug: string; stopped: boolean }[] } | null
    for (const b of r?.batches || []) {
      if (!b.stopped) continue
      logger.info(`${slug}: import ${b.requestSlug} was stopped (the app restarted), resuming`)
      await fetch(`${url}/api/${slug}/imports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: b.requestSlug, action: "resume" }) }).catch(() => null)
    }
  }

  private async hits(query: string, slug: string, limit: number): Promise<WyeHit[]> {
    const args = ["ask-search", query.slice(0, 1000), "--product", slug, "--rerank", "--limit", String(Math.min(60, limit)), "--json"]
    if (this.graph) args.push("--expand"); else args.push("--source", "doc")
    const j = JSON.parse(await wye(args)) as { hits: { title: string; text: string; score: number; ref: string; source: string }[] }
    return (j.hits || []).filter((h) => h.source === "doc" || h.source === "node").map((h) => {
      // a page passage names its session and date in its title; a card is its own statement, its id its source
      if (h.source === "doc") {
        const page = h.title.split(" › ")[0].replace(/^"(.*)"$/, "$1")
        const [sessionId, date] = page.split(" · ")
        return { content: h.text, sessionId, date: date || undefined, score: h.score, ref: h.ref }
      }
      return { content: h.title && !h.text.startsWith(h.title) ? `${h.title}. ${h.text}` : h.text, sessionId: h.ref, score: h.score, ref: h.ref }
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    return this.hits(query, slugOf(options.containerTag), options.limit ?? 10)
  }

  // Wye answers for itself (decision:waterfall.memorybench-wye-answers): `wye ask` — the deep lane, a read-only agent
  // that searches the vault, or the fast lane over its own retrieval (WYE_BENCH_LANE=fast) — with the run's answering
  // model. Its answer is what the judge grades; the search phase above only measures retrieval.
  async answer(question: string, o: { containerTag: string; questionDate?: string; model: string }): Promise<string> {
    const lane = process.env.WYE_BENCH_LANE === "fast" ? "fast" : "deep"
    const q = o.questionDate ? `${question}\n\n(Asked on ${o.questionDate}.)` : question
    const j = JSON.parse(await wye(["ask", q, "--product", slugOf(o.containerTag), `--${lane}`, "--model", o.model, "--json"])) as { fast: string; deep: string; errors: { lane: string; message: string }[] }
    const text = (lane === "deep" ? j.deep || j.fast : j.fast).trim()
    if (!text) throw new Error(`wye ask gave no answer: ${(j.errors || []).map((e) => `${e.lane}: ${e.message}`).join("; ").slice(0, 300)}`)
    // its [n] citations are for a reader, not the judge
    return text.replace(/\s*\(?\[\d+(?:\s*[,\]\[]\s*\d+)*\]\)?/g, "").replace(/\s*\(\s*\)/g, "")
  }

  async clear(containerTag: string): Promise<void> {
    const slug = slugOf(containerTag)
    rmSync(join(VAULTS, slug), { recursive: true, force: true }); rmSync(join(STAGE, slug), { recursive: true, force: true })
    const home = process.env.WYE_HOME
    if (home) rmSync(join(home, "data", "products", slug), { recursive: true, force: true })
    this.known.delete(slug)
  }
}

// the same vaults with the pages only, no analysis: the baseline that shows what the graph adds
export class WyePagesProvider extends WyeProvider {
  name = "wye-pages"
  graph = false
}

export default WyeProvider
