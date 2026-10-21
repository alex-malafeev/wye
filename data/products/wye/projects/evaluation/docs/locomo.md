---
node: module:eval-locomo
type: module
title: wye on LoCoMo — long-conversation memory through an analysed import and Ask
status: proposed
owner: alex
last-verified: 2026-10-21
order: 40
sources:
  - eval/public/memorybench/index.js            # the adapter: scratch app, claude shim, run, report
  - eval/public/memorybench/provider/index.ts   # Wye as a MemoryBench provider: ingest, import, search, answer
  - packages/web/src/lib/ask/graphq.ts          # the graph step inside Ask
  - prompts/import.md                           # the per-page import skill (time as properties)
  - prompts/import-setup.md                     # the setup turn: types, recurring entities, guide
---

# wye on LoCoMo: long-conversation memory through an analysed import and Ask

*Run `wye-locomo-full-2`, 21 October 2026. MemoryBench e8d6e1f, LoCoMo-10, all 1,986 questions.*

## Abstract

Can a knowledge vault built by agents from a conversation answer questions about that conversation as well as a
memory layer built for the purpose? We imported each of the ten LoCoMo conversations into its own Wye vault with
`wye import`: an agent first set up the types and the recurring entities, then each session became linked, dated
cards. We then let Wye answer every benchmark question itself with `wye ask`. That means a hybrid full-text and
vector search, a graph step that follows the question's entities and planner-written graph queries, and a read-only
answering agent. A Sonnet 5.5 judge graded the answers with MemoryBench's per-type LoCoMo prompts.

On the 1,540 questions usually reported (adversarial category left out), Wye answered **93.0%** correctly; on all
1,986 questions, **92.2%**. Single-hop recall scored 96.2%, temporal 92.8%, multi-hop 91.8%, adversarial 89.7% and
open-domain inference 68.8%. Retrieval found a relevant passage in the top 10 for 97.3% of questions. A median
answer took 51 s. Because the answering and judging model is stronger than the gpt-4o-mini and GPT-4o models behind
most published LoCoMo figures, and because we ran no full-context control, this result does not isolate how much the
memory itself contributes.

## 1. Introduction

LoCoMo (Maharana et al., 2024) is the most quoted benchmark for long-term conversational memory. Ten two-person
conversations, each spread over 19–32 dated sessions, come with 1,986 questions in five categories. Memory products
report their LoCoMo score as evidence that they remember, and Supermemory's MemoryBench packages the benchmark with a
provider interface so that products can be measured the same way.

Wye is not a conversational memory layer. It is a knowledge vault, a folder of markdown pages whose blocks are typed
cards linked into a graph, which agents and people read and write. Its import turns documents into cards; its Ask
answers questions from the cards, the pages and the code. This report asks three questions:

1. How well does the general path a person would use (import the material, ask the question) do on LoCoMo, with
   nothing tuned to the benchmark?
2. Where does it fail, and are the failures in retrieval, in what the import kept, or in answering?
3. Where does the result sit next to published LoCoMo numbers, and what does that comparison allow us to say?

## 2. Method

### 2.1 Data

LoCoMo-10 as shipped with MemoryBench (`data/benchmarks/locomo/locomo10.json`):

| Conversation | Sessions | Turns | Words | Questions | Without adversarial |
|---|---:|---:|---:|---:|---:|
| conv-26 | 19 | 419 | 10,433 | 199 | 152 |
| conv-30 | 19 | 369 | 8,021 | 105 | 81 |
| conv-41 | 32 | 663 | 16,187 | 193 | 152 |
| conv-42 | 29 | 629 | 13,312 | 260 | 199 |
| conv-43 | 29 | 680 | 15,790 | 242 | 178 |
| conv-44 | 28 | 675 | 15,328 | 158 | 123 |
| conv-47 | 31 | 689 | 14,933 | 190 | 150 |
| conv-48 | 30 | 681 | 13,671 | 239 | 191 |
| conv-49 | 25 | 509 | 11,455 | 196 | 156 |
| conv-50 | 30 | 568 | 14,854 | 204 | 158 |
| **Total** | **272** | **5,882** | **133,984** | **1,986** | **1,540** |

The question categories are single-hop fact recall (841), multi-hop across sessions (282), temporal reasoning (321),
open-domain inference that needs world knowledge (96), and adversarial questions whose premise is false or not in
the conversation (446). We ran every question; no sampling.

### 2.2 System under test

Each conversation became its own new vault, created with `wye init`. Each session was written as one dated markdown
page, titled with its session id and date and with every turn as `**Speaker (time):** text`. The import was given
one sentence about the material, the same for every benchmark: *"Dated conversation sessions."*

**Import.** `wye import <folder> --brief "…"` ran Wye's ordinary analysed import in two steps:

- **Setup turn**: one agent read the whole batch and declared the vault's types (for example `person`, `event`,
  `fact`, `place`, `pet`, `org`). It created the recurring entities once (the two speakers, their family, pets,
  places, groups) and wrote a guide for the page agents: which types to use, how to link, and where each page's
  date is.
- **Page lanes**: agents then rewrote the pages, one or a few per turn, into cards. Each card links to its subject
  (`participants`, `about`, `owner`, …). Each dated card carries its time as properties, as precise as the source
  allows (`date: 2023-05-20`, `2023-05` or `2023`; `starts`/`ends` for a span; `since`/`until` for a state). Relative
  times ("last Saturday") were made absolute against the page's own date (decision:waterfall.import-tracks-time).
- **Models**: the setup turns and the first page lanes of some vaults ran on the claude CLI's default model at the
  time (Claude Opus 4.8); later page lanes ran on Claude Sonnet 5.5. The import was not configured per benchmark.
  The mix is an artefact of the session defaults, noted in §6.

**Answering.** Every question went to `wye ask "<question> (Asked on <date>.)" --deep --model claude-sonnet-5-5`
against the conversation's vault (decision:waterfall.memorybench-wye-answers). Inside, Ask ran four steps
(decision:waterfall.ask-queries-the-graph):

1. **Search**: BM25 full-text plus vector search (all-MiniLM-L6-v2) over cards and page passages, reranked by a
   cross-encoder (jina-reranker-v1-turbo-en).
2. **Graph step**:
   - Entities named in the question are matched to nodes by title or alias, and their 1-hop links are followed.
   - Nodes that several of those entities share are ranked first.
   - A planner (Claude Haiku 5.5) is given the vault's kinds, link types and time span. It writes up to four graph
     queries (start nodes, link verbs, kinds, a time window, words, one or two hops), then up to three follow-ups on
     what those found.
   - The nodes reached are reranked against the question, and up to 20 join the search hits.
3. **Deep lane**: a read-only Claude Sonnet 5.5 agent is given the hits and the graph findings as its starting list.
   It may open pages and nodes with `wye` (at most 20 tool calls, 120 s) and writes the answer with citations.
   Its brief (`prompts/ask-deep.md`) states general rules, none drawn from the benchmark
   (constraint:waterfall.prompts-state-rules, decision:waterfall.ask-infers-when-asked):
   - the answer comes first, alone on its line, then its evidence;
   - a question about what is likely or might be gets the best inference, marked as inferred;
   - before saying something is not recorded, the agent opens the subject's node and its links;
   - a premise the sources contradict is never accepted.
4. **Post-processing**: the `[n]` citation markers were stripped before judging, and nothing else was changed.

Nothing is exposed beyond a question in and an answer out. The graph step is internal to Ask.

### 2.3 Protocol

The MemoryBench pipeline ran ingest, indexing (the import), search, answer, evaluate and report. Two of these phases
needed extra provisions for Wye:

- **Search phase.** The search phase ran `wye ask-search --rerank --expand --limit 10` and scores retrieval only.
  MemoryBench's LLM marks each of the ten hits relevant or not to the gold answer.
- **Answer phase.** The answer phase took Wye's own answer as the hypothesis. MemoryBench's answer step was patched
  so that a provider with an `answer` method answers for itself. No context was handed to a separate answering
  model, so MemoryBench's context-token count is 0 by construction, not a measurement.

Judging and isolation:

- **Judge**: Claude Sonnet 5.5, MemoryBench's default per-type LoCoMo judge prompt, one pass per question, binary
  correct/incorrect.
- **Model access**: all model calls went through the local claude CLI, via a shim on MemoryBench's Anthropic
  endpoint; no API keys were used.
- **Isolation**: the vaults lived in a scratch Wye app on port 3457 with its own home (`~/wye-bench/home`), run in
  dev mode from the repository checkout. The person's live app was never touched.

Concurrency was 4 imports at a time, 4 searches and 10 answers.

**Incident.** At 09:43 UTC, with 94 of 272 sessions imported, the scratch app went over its 4 GB memory cap and shut
down by design. The bench had started it directly, not under `wye app`'s supervisor, so it stayed down for 2 h 14 min.
We fixed the adapter (commit 2b92dbd): it now restarts the app on the cap's exit code, with an 8 GB cap for the
bench, and resumes any import a restart stopped. We then resumed the run from its checkpoint at 11:57. No imported
session was redone or lost. Two imports (conv-41, conv-42) continued from the first unfinished page.

## 3. Results

### 3.1 Accuracy

| Category | n | Correct | Accuracy |
|---|---:|---:|---:|
| Single-hop | 841 | 809 | **96.2%** |
| Temporal | 321 | 298 | **92.8%** |
| Multi-hop | 282 | 259 | **91.8%** |
| Open-domain | 96 | 66 | **68.8%** |
| Adversarial | 446 | 400 | **89.7%** |
| **Without adversarial (LoCoMo J, as usually reported)** | **1,540** | **1,432** | **93.0%** |
| **All questions** | **1,986** | **1,832** | **92.2%** |

With n = 1,540, the 95% interval on the headline is about ±1.3 points from sampling alone. That does not include
judge variance, which we did not measure (§6).

### 3.2 By conversation

| Conversation | All questions | Without adversarial |
|---|---:|---:|
| conv-26 | 94.0% | 95.4% |
| conv-30 | 94.3% | 96.3% |
| conv-41 | 96.9% | 96.7% |
| conv-42 | 91.2% | 92.0% |
| conv-43 | 86.4% | 87.6% |
| conv-44 | 91.1% | 91.1% |
| conv-47 | 90.5% | 92.0% |
| conv-48 | 93.7% | 93.2% |
| conv-49 | 92.9% | 94.2% |
| conv-50 | 93.6% | 93.7% |

The spread is 87.6–96.7% on the headline set. conv-43 is the weakest, at 87.6%.

### 3.3 Retrieval (search phase, k = 10)

| Metric | Value |
|---|---:|
| Hit@10 | 97.3% |
| Recall@10 | 97.3% |
| Precision@10 | 25.8% |
| F1@10 | 38.7% |
| MRR | 0.854 |
| NDCG@10 | 0.850 |

By category, Hit@10 was 99% for single-hop, 98% for temporal and multi-hop, 96% for open-domain and 94% for
adversarial.

### 3.4 What the import built

| Conversation | Knowledge cards | Events + facts | With a time property* | Links between cards | Setup | Page lanes |
|---|---:|---:|---:|---:|---:|---:|
| conv-26 | 118 | 94 | 64% | 363 | 8.0 min | 20.9 min |
| conv-30 | 105 | 95 | 15% | 320 | 4.9 min | 11.6 min |
| conv-41 | 179 | 147 | 75% | 368 | 6.4 min | 25.3 min |
| conv-42 | 247 | 217 | 37% | 395 | 7.5 min | 25.3 min |
| conv-43 | 187 | 149 | 67% | 472 | 5.9 min | 23.5 min |
| conv-44 | 107 | 92 | 68% | 571 | 5.5 min | 27.8 min |
| conv-47 | 210 | 155 | 63% | 526 | 6.5 min | 19.6 min |
| conv-48 | 220 | 184 | 32% | 490 | 4.8 min | 20.2 min |
| conv-49 | 139 | 129 | 64% | 435 | 5.5 min | 16.4 min |
| conv-50 | 155 | 140 | 91% | 503 | 3.8 min | 20.2 min |
| **Total** | **1,667** | **1,402** | — | **4,443** | **59 min** | **211 min** |

\* Read from the built graph: an event or fact card whose properties carry an ISO `date`, `starts`, `ends`, `since`
or `until`. This counts only that one form, so it is a lower bound. A card dated only in its text is not counted.

Knowledge cards exclude the page structure (blocks, properties) and the vault's system nodes. Links exclude the
structural `part-of`/`has` edges. The agents' own reported cost for the import was $44.42. That is a lower bound,
because some sessions reported none, and it is the CLI's price figure, not a bill.

### 3.5 Latency

| Phase | Median | p95 | Max |
|---|---:|---:|---:|
| Search (`wye ask-search`) | 1.6 s | 3.8 s | 6.8 s |
| Answer (`wye ask --deep`, incl. graph step) | 50.6 s | 99.0 s | 184 s |
| Judge | 16.1 s | 28.4 s | 46 s |

Wall clock, excluding the 2 h 14 min outage: import about 2 h 30 min at 4 conversations at a time, search 21 min,
answering 4 h 2 min at 10 at a time, judging 1 h 31 min.

## 4. Analysis

### 4.1 Where the errors are

Of the 154 wrong answers, 108 are outside the adversarial category: 32 single-hop, 30 open-domain, 23 temporal and
23 multi-hop.

- **Retrieval is rarely the cause.** For 99 of those 108 (92%), the search phase had a relevant passage in its top
  10. Wye mostly failed after the evidence had been found.
- **"Not in the vault" despite the evidence.** 10 of the 108 still say the vault does not record the thing asked,
  although the search had found a relevant passage. Either the import turned that line of chat into no card, or the
  agent did not read far enough within its 20-call budget; we did not separate the two.
- **Temporal off-by-one.** Some temporal misses resolve a relative date one day off. "The Sunday before 25 May" was
  answered as Saturday 20 May. Others give only the month the import kept ("July 2023") where the gold answer is
  "two weekends before 17 July".
- **Open-domain inference (68.8%)** is still the weakest category. Its gold answers are speculative judgements, and
  Wye now gives its best inference and marks it as such. Where it misses, it usually commits to a different
  reasonable reading of the same evidence than the gold one:
  - "Would Caroline be considered religious?": gold "Somewhat, but not extremely", answered "Probably not … more
    spiritual than religious";
  - "What might John's financial status be?": gold "Middle-class or wealthy", answered "probably tight", from his
    job loss.

  Some gold answers rest on a detail only a shared photo shows, which the import keeps as a caption at most.

### 4.2 Adversarial questions

LoCoMo's adversarial questions mostly swap the speakers: they ask about Caroline what Melanie did. 46 of 446 were
marked wrong. In most of them Wye answered the premise as asked. Where it corrects the premise (*"No. Caroline didn't
make the bowl. Melanie did."*) the judge mostly accepts it against the gold "Not mentioned in the conversation", but
not always. How many of the 46 are judge disagreements, and not real errors, would need a manual read.

### 4.3 Answer form

- **Long answers.** The median answer is 128 words: a direct answer, then its evidence. LoCoMo's gold answers are a
  few words. LLM judges are known to be lenient with long answers that contain the right one (Penfield Labs, 2026),
  so the long form may raise the score as well as lower it. We did not test a short-answer variant.
- **Leaked working notes.** 93 answers (4.7%) begin with the deep agent's working notes ("Let me check the source
  session…", "Need Melanie's own statement; search session 14."), all of them judged correct. These were a defect in
  the deep lane's output: it now holds back what the agent writes before a tool call, and the answer is the agent's
  last message (32bfcc7).

## 5. Comparison with published results

| System | LoCoMo J (without adversarial) | Answering / judge | Source |
|---|---:|---|---|
| **Wye (this run)** | **93.0%** | Sonnet 5.5 / Sonnet 5.5 | this report |
| Mem0 (new algorithm, managed platform) | 92.5% | not stated | Mem0 README, April 2026 |
| Zep | 94.7% (vendor), 75.1% (corrected earlier figure) | not stated / gpt-4o-mini | vendor pages |
| Supermemory | 77.1% | GPT-4o / not stated | team reply, GitHub issue #795 |
| Full context | 72.9% | gpt-4o-mini / gpt-4o-mini | Mem0 paper, Table 2 |
| Mem0 graph / base (2025) | 68.4% / 66.9% | gpt-4o-mini / gpt-4o-mini | Mem0 paper, Table 2 |
| Best RAG baseline | 61.0% | gpt-4o-mini / gpt-4o-mini | Mem0 paper, Table 2 |

What can and cannot be read from this table:

- **The models differ.** Wye's answers and grades come from Claude Sonnet 5.5. The 2025 rows used gpt-4o-mini, and
  Supermemory's figure used GPT-4o. A stronger answering model raises the score with any memory behind it. The Mem0
  paper's own full-context row, 72.9% with gpt-4o-mini, shows how much the model alone carries, because every
  LoCoMo conversation (8–16k words) fits in context. We did not run Sonnet 5.5 with the full conversation in context,
  so we cannot say how much of Wye's 93.0% the vault adds over the model alone.
- **Most recent figures are self-reported** and name neither the answering model nor the judge. Mem0's own October
  2026 review notes that no two published LoCoMo numbers share a model, judge and retrieval setup.
- **The benchmark has known faults.** An audit found that 6.4% of the 1,540 gold answers are wrong, so a perfect
  system would score about 93.6%. It also found that the judge accepts up to 63% of intentionally wrong answers
  (Penfield Labs, 2026). Wye's 93.0% is close to that ceiling, and differences of a few points near the top are
  within that noise.

Read with these caveats, Wye's 93.0% is in the range the current memory products report. That is true even though
Wye was given no benchmark-specific tuning, and it used the same import and Ask a person would use on their own
documents. The table does not show that Wye is better or worse than any of them.

## 6. Limitations

1. **No ablations.** We did not run:
   - pages only, without the analysed import (the `wye-pages` provider exists);
   - Ask without the graph step;
   - the fast lane;
   - Sonnet 5.5 with the full conversation in context.

   The contribution of each part is therefore unknown.
2. **One judge, one pass.** The judge comes from the same model family as the answering agent, which may favour its
   style. We ran no repeated judging and no human check of the judgements.
3. **Mixed import models.** The setup turns and some page lanes ran on Opus 4.8, the rest on Sonnet 5.5.
4. **One run.** The import and the answers are not deterministic, so a second run would differ by an unmeasured
   amount.
5. **Dev-mode app.** The scratch app ran in development mode, which costs memory (the outage in §2.3) but should not
   change answers.
6. **Cost not fully measured.** The answer phase's cost was not recorded, and the import cost is a lower bound.

## 7. Reproduction

```bash
wye eval public memorybench --fetch                       # MemoryBench e8d6e1f + the wye provider
wye eval public memorybench --run --product waterfall \
    --set locomo --run-id wye-locomo-full-2 --parallel 4  # scratch app on 3457, claude shim, full run
```

Outputs:

- **Run checkpoint and report**: `eval/public/memorybench/data/repo/data/runs/wye-locomo-full-2/` (`checkpoint.json`,
  `report.json`).
- **Summary**: `data/products/wye/_build/eval/2026-10-21-public-memorybench-locomo.json`.
- **Vaults**: `~/wye-bench/vaults/mb-conv-*-wye-locomo-full-2-*`.

Code at the time of the run:

| Commit | What it changed |
|---|---|
| e18f798 | agent slots |
| 584ee75 | `wye ask --model`, Wye answers |
| b52cf9e | import tracks time |
| 68134b8 | graph step in Ask |
| 2b92dbd | scratch app restart, import resume |
| 32bfcc7 | Ask's deep lane: the answer is the last message; the brief's answer rules |
| 6c4b55e | the import and Ask prompts stated as general rules |

## References

- Maharana, A., Lee, D.-H., Tulyakov, S., Bansal, M., Barbieri, F., Fang, Y. (2024). *Evaluating Very Long-Term
  Conversational Memory of LLM Agents* (LoCoMo). arXiv:2402.17753.
- Chhikara, P. et al. (2025). *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*.
  arXiv:2504.19413, Table 2.
- Supermemory. *MemoryBench*. github.com/supermemoryai/memorybench, commit e8d6e1f.
- Supermemory. *What is the exact score on LoCoMo?* GitHub issue #795, supermemoryai/supermemory (closed April
  2026).
- Mem0. README and research page, github.com/mem0ai/mem0, mem0.ai/research (April 2026); *AI Memory Benchmarks:
  LoCoMo vs. LongMemEval vs. BEAM* (2026).
- Penfield Labs (2026). *We audited LoCoMo: 6.4% of the answer key is wrong and the judge accepts up to 63% of
  intentionally wrong answers*.
