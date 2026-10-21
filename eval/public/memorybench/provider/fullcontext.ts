// The same-model baseline for the wye provider (plan:memorybench): no memory system at all — every session of the
// container goes to the answering model, oldest first. Published rows used other answering models (gpt-4o-mini,
// gpt-4o); this row answers with the same model and prompts as Wye's, so the two are read against each other.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Provider, ProviderConfig, IngestOptions, IngestResult, SearchOptions, IndexingProgressCallback } from "../../types/provider"
import type { UnifiedSession } from "../../types/unified"
import { WYE_PROMPTS, type WyeHit } from "./prompts"
import { slugOf } from "./index"

const DIR = join(process.env.WYE_BENCH_DIR || join(homedir(), "wye-bench"), "fullcontext")

export class FullContextProvider implements Provider {
  name = "wye-full"
  prompts = WYE_PROMPTS
  concurrency = { default: 10, ingest: 1 }

  async initialize(_config: ProviderConfig): Promise<void> { mkdirSync(DIR, { recursive: true }) }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const file = join(DIR, `${slugOf(options.containerTag)}.json`)
    const all: WyeHit[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []
    for (const s of sessions) {
      const date = (s.metadata?.formattedDate as string) || (s.metadata?.date as string) || undefined
      const content = s.messages.map((m) => `**${m.speaker || m.role}${m.timestamp ? ` (${m.timestamp})` : ""}:** ${m.content.trim()}`).join("\n\n")
      all.push({ content, sessionId: s.sessionId, date, score: 0, ref: s.sessionId })
    }
    writeFileSync(file, JSON.stringify(all))
    return { documentIds: sessions.map((s) => s.sessionId) }
  }

  async awaitIndexing(result: IngestResult, _tag: string, onProgress?: IndexingProgressCallback): Promise<void> {
    onProgress?.({ completedIds: result.documentIds, failedIds: [], total: result.documentIds.length })
  }

  // every session, in the order they happened — the limit does not apply
  async search(_query: string, options: SearchOptions): Promise<unknown[]> {
    const file = join(DIR, `${slugOf(options.containerTag)}.json`)
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []
  }

  async clear(containerTag: string): Promise<void> { rmSync(join(DIR, `${slugOf(containerTag)}.json`), { force: true }) }
}

export default FullContextProvider
