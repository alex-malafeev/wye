---
node: module:eval-next-benchmarks
type: module
title: Proposed experiments and benchmarks after LoCoMo
status: proposed
owner: alex
last-verified: 2026-10-21
order: 41
---

# Proposed experiments and benchmarks after LoCoMo

The LoCoMo run (module:eval-locomo) gave Wye 90.1% on the usual 1,540 questions. Two questions are still open. How
much of that score is the vault and how much the model? And how does Wye do where memory has to do the work? This
page lists what would answer them, in the order we would run them. Nothing here has been run.

The dates and facts about outside benchmarks come from a search on 21 October 2026. Where they rest only on
third-party reports, the text says so; check them against the official page before relying on them.

## A. Experiments on LoCoMo (the vaults already exist)

These reuse the ten imported vaults and the search results of run `wye-locomo-full-2` through `--from-run`, so they
need no new import.

| # | Experiment | What it answers | Rough cost |
|---|---|---|---|
| A1 | **Full-context control.** Sonnet 5.5 answers with the whole conversation in context, no Wye (the `wye-full` provider). | How much of 90.1% the model alone gets. Every LoCoMo conversation (8–16k words) fits in context, so this is a high bar. | ~1 h, no import |
| A2 | **Regression check of the Ask fixes** (decision:waterfall.ask-infers-when-asked). Re-answer the 1,747 questions that passed, after the 239 that failed are re-answered. | Whether "give the best inference" costs adversarial or single-hop questions what it gains on open-domain. | ~1.5 h |
| A3 | **Ablations**, the same questions each time: pages only (`wye-pages`, no analysed import); Ask without the graph step (`graph: false`); the fast lane instead of the deep one. | What the import, the graph step and the agent each add. | ~1.5 h each; `wye-pages` needs its own plain import |
| A4 | **Smaller answering models**: Haiku 5.5, and Opus 5.5 for the top end (`--model`). | How much the score rests on the model; the cost against quality curve. | ~1.5 h each |
| A5 | **Judge variance**: judge the same answers three times, and once with a judge from another family (codex CLI). Hand-check a sample of 50 wrong verdicts, especially adversarial ones where Wye corrected the premise. | How much of the score is the judge; how many "wrong" answers are right. | ~30 min per pass, plus reading |
| A6 | **Short answers**: ask for the answer alone, with no evidence after it. | Whether the 132-word median answers raise or lower the judged score. LLM judges are reported to be lenient with long answers. | ~1.5 h |
| A7 | **Second run** of the whole pipeline, import included. | Run-to-run spread; one run is not a measurement. | ~5 h |
| A8 | **Cost and tokens per answer**: record the deep lane's cost and tokens. | What an answer costs, which MemoryBench reports as 0 for a provider that answers itself. | instrumentation only |

A1, A2 and A5 come before any public claim. The article's comparison rests on them.

## B. Benchmarks to run next

### B1. LongMemEval: the cheapest next step

- **What it is.** Long multi-session chat histories with questions on information extraction, multi-session
  reasoning, temporal reasoning, knowledge updates and abstention.
- **Why next.**
  - It's already built into MemoryBench, so it's the same pipeline and the same provider.
  - It's the figure Supermemory, Mem0 and Zep all publish. Supermemory reports 81.6% with GPT-4o, and 85.2% with
    Gemini, per Mastra's leaderboard.
  - Its knowledge-update questions test what Wye's `supersedes` and `since`/`until` are for.
- **Plan.** Run a 20-question sample per type first, as with LoCoMo, then the full set.
- **Also.** LongMemEval-V2 (arXiv 2605.12493, May 2026) exists. We found no published scores for it yet.

### B2. Agent Memory Leaderboard (AML): the fair comparison

- **Who and when.** Launched 29 July 2026 by researchers from more than 20 institutions; first results 12–13
  August 2026.
- **What it fixes.** The answering model and the scoring pipeline are the same for every system, which plug in
  through a standard Add / Search interface. That removes the problem with our LoCoMo comparison: the answer model
  differs from system to system.
- **Text track.** About 5,000 questions drawn from LoCoMo-Refined, BEAM, LongMemEval, PersonaMem and others.
- **First cycle.** The leader scored 58.0 and the best open-source system 45.1; plain RAG reportedly ranked near the
  top of the academic track. Third-party reports give cycle 2's submission deadline as **31 October 2026**, with
  results in mid-November. Not checked on the official page.
- **What Wye needs.**
  - An Add / Search adapter: Add is `wye import` of a session, Search is `wye ask-search`.
  - AML measures search only, so Wye's own answering agent would not take part. The comparison is then of what Wye
    retrieves, which is the part the vault owns.
- **Open question:** can a system that builds its memory with an agent at import time take part within AML's rules
  and time limits?

### B3. BEAM: memory that has to do the work

- **What it is.** Published October 2025, at ICLR 2026: 100 conversations and 2,000 questions, with histories up
  to 10M tokens.
- **Why it matters.** Unlike LoCoMo, it cannot be answered by putting the conversation in context, so the score
  says what the memory adds. Mem0 reports 64.1% on BEAM-1M and 48.6% on BEAM-10M (April 2026).
- **What it needs.** MemoryBench has no BEAM loader, so it needs an adapter; the data is on Hugging Face
  (Mohammadta/BEAM-10M). The import is the cost: 10M tokens through an agent per page is far more than LoCoMo's
  134k words.
- **Plan.** Measure the import's time and cost on one BEAM-1M conversation before committing to a set.

### B4. ConvoMem, already in MemoryBench

- **What it is.** Conversational memory questions, in the same pipeline as LoCoMo.
- **Plan.** A 20-per-type sample, run next to LongMemEval at little extra effort.

### Watched, not proposed yet

These are recent and still early, or we could not verify them:
- StreamMemBench (arXiv 2606.14571);
- MemTrace (arXiv 2606.17328);
- Microsoft's STATE-Bench and DolphinBench, only mentioned in a Mem0 blog post.

## C. Fixes the LoCoMo analysis points to

These come from the errors, not from a benchmark. Each is measured by re-answering the questions it concerns.

- **Photos.** Record what a shared photo shows when it carries information. 2–4 open-domain misses had their
  evidence only in a photo caption.
- **Read past the cards.** Before saying something is not recorded, read the source passage of the cards it
  found. 66 of the 153 non-adversarial misses said "not recorded" although the search had a relevant passage.
- **Relative dates.** Check how the import resolves a relative date against the session's date ("the Sunday
  before …"); several temporal misses were a day off.

## Sources

- Mem0: [README](https://github.com/mem0ai/mem0), [research](https://mem0.ai/research),
  [AI Memory Benchmarks: LoCoMo vs. LongMemEval vs. BEAM](https://mem0.ai/blog/ai-memory-benchmarks-in-2026),
  [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Supermemory: [issue #795](https://github.com/supermemoryai/supermemory/issues/795);
  [MemoryBench](https://github.com/supermemoryai/memorybench); Mastra,
  [Observational Memory](https://mastra.ai/research/observational-memory) (LongMemEval leaderboard)
- BEAM: [arXiv 2510.27246](https://arxiv.org/abs/2510.27246),
  [ICLR 2026](https://iclr.cc/virtual/2026/poster/10006595),
  [Hugging Face](https://huggingface.co/datasets/Mohammadta/BEAM-10M)
- AML: [leaderboard](https://agent-memory-leaderboard-leaderboard.static.hf.space/index.html),
  [besthub](https://www.besthub.dev/articles/agent-memory-leaderboard-launch-who-will-lead-the-next-generation-memory-paradigm-revolution-20f9525851d4),
  [everydev](https://www.everydev.ai/tools/agent-memory-leaderboard)
- LoCoMo audit: [Penfield Labs](https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer)
- Lists: [Awesome-Agent-Memory](https://github.com/TeleAI-UAGI/Awesome-Agent-Memory),
  [StreamMemBench](https://arxiv.org/pdf/2606.14571), [MemTrace](https://arxiv.org/pdf/2606.17328)
