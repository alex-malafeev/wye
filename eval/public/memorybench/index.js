'use strict';
// MemoryBench — Wye on the benchmarks Supermemory publishes, in Supermemory's own open harness (plan:memorybench,
// decision:waterfall.memorybench-is-the-public-harness, decision:waterfall.memorybench-measures-retrieval-first).
//   wye eval public memorybench --fetch      clones github.com/supermemoryai/memorybench (MIT) at a pinned commit, installs
//                                            Bun and its packages locally, and adds the `wye` provider (provider/) to it
//   wye eval public memorybench --run --set locomo|longmemeval|convomem [--sample n] [--limit n] [--model sonnet-5.5]
//                                            a scratch Wye app (its own home and port, never the live one), the claude shim
//                                            for answering and judging, then MemoryBench's run with `-p wye`
//   wye eval public memorybench --report     every run's report.json as a result file and the table beside the published rows
// The answering model and the judge are Claude through the claude CLI (claude-shim.js): no API key on this machine
// (question:waterfall.memorybench.models), so Wye's numbers are set beside the published ones with that difference named.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { REPO, loadProduct } = require('../../lib/product');
const { writeResult } = require('../../lib/results');

const PIN = 'e8d6e1f';
const DATA = path.join(__dirname, 'data');
const MB = path.join(DATA, 'repo');
const BUN = path.join(DATA, 'bun-tool', 'node_modules', '.bin', 'bun');
const BENCH = process.env.WYE_BENCH_DIR || path.join(os.homedir(), 'wye-bench');
const HOME = path.join(BENCH, 'home');
const PORT = String(process.env.WYE_BENCH_PORT || 3457);
const SHIM_PORT = String(process.env.WYE_BENCH_SHIM_PORT || 3471);
const SOURCE = 'github.com/supermemoryai/memorybench (MIT); supermemory.ai/research; LoCoMo: snap-research/locomo; LongMemEval: xiaowu0162/longmemeval-cleaned; ConvoMem: Salesforce/ConvoMem';

// Claude models MemoryBench does not list yet, by their ids — the shim passes the id to `claude --model`
const MODELS = ['sonnet-5.5:claude-sonnet-5-5:Claude Sonnet 5.5', 'haiku-5.5:claude-haiku-5-5:Claude Haiku 5.5', 'opus-5.5:claude-opus-5-5:Claude Opus 5.5'];

function edit(file, marker, fn) { const f = path.join(MB, file); const s = fs.readFileSync(f, 'utf8'); if (s.includes(marker)) return; const t = fn(s); if (t === s) throw new Error(`memorybench changed: could not patch ${file}`); fs.writeFileSync(f, t); }
function patch() {
    const dst = path.join(MB, 'src', 'providers', 'wye'); fs.mkdirSync(dst, { recursive: true });
    for (const f of ['index.ts', 'prompts.ts']) fs.copyFileSync(path.join(__dirname, 'provider', f), path.join(dst, f));
    edit('src/providers/index.ts', 'WyeProvider', s => s.replace(/(import \{ RAGProvider \} from "\.\/rag"\n)/, '$1import { WyeProvider } from "./wye"\n').replace(/(  rag: RAGProvider,\n)/, '$1  wye: WyeProvider,\n'));
    edit('src/types/provider.ts', '"wye"', s => s.replace(/(export type ProviderName = [^\n]*)/, '$1 | "wye"'));
    edit('src/utils/config.ts', 'case "wye"', s => s.replace(/(    case "rag":\n)/, '    case "wye":\n      return { apiKey: "" } // the wye CLI against a scratch app (WYE_URL)\n$1'));
    edit('src/utils/models.ts', '"sonnet-5.5"', s => s.replace(/(  "sonnet-4\.5": \{)/, MODELS.map(m => { const [alias, id, name] = m.split(':'); return `  "${alias}": {\n    id: "${id}",\n    provider: "anthropic",\n    displayName: "${name}",\n    supportsTemperature: true,\n    defaultTemperature: 0,\n    maxTokensParam: "maxTokens",\n    defaultMaxTokens: 1000,\n  },\n`; }).join('') + '$1'));
}

function fetchAll(log) {
    fs.mkdirSync(DATA, { recursive: true });
    if (!fs.existsSync(path.join(MB, 'package.json'))) { log('cloning MemoryBench'); execFileSync('git', ['clone', 'https://github.com/supermemoryai/memorybench', MB], { stdio: 'inherit' }); }
    execFileSync('git', ['-C', MB, 'checkout', '-q', '--', '.']); execFileSync('git', ['-C', MB, 'checkout', '-q', PIN]);
    if (!fs.existsSync(BUN)) { log('installing Bun locally'); execFileSync('npm', ['i', '--silent', '--no-save', '--prefix', path.join(DATA, 'bun-tool'), 'bun@1.2.23'], { stdio: 'inherit' }); }
    execFileSync(BUN, ['install'], { cwd: MB, stdio: 'inherit' });
    patch();
    return { repo: MB, commit: PIN };
}

const up = async url => fetch(`${url}/api/products`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok, () => false);
async function waitFor(check, what, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 1000)); } throw new Error(`${what} did not come up`); }

// the scratch app: its own home under ~/wye-bench and its own port; started once and left running for the next run
async function scratchApp(log) {
    if (PORT === '3456') throw new Error('WYE_BENCH_PORT 3456 is the live app — the benchmark never writes there');
    const url = `http://localhost:${PORT}`;
    if (await up(url)) return url;
    fs.mkdirSync(HOME, { recursive: true });
    log(`starting a scratch Wye app on ${url} (home ${HOME})`);
    const out = fs.openSync(path.join(BENCH, 'app.log'), 'a');
    spawn(process.execPath, [path.join(REPO, 'bin', 'wye.js'), 'app', '--no-open', '--port', PORT], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, WYE_HOME: HOME, WYE_PORT: PORT, WF_HOOKS: '0' } }).unref();
    await waitFor(() => up(url), 'the scratch app', 90000);
    return url;
}

async function runIt(o, log) {
    if (!fs.existsSync(path.join(MB, 'src', 'providers', 'wye', 'index.ts'))) throw new Error('no MemoryBench checkout with the wye provider — run: wye eval public memorybench --fetch');
    const bench = o.set || 'locomo'; if (!['locomo', 'longmemeval', 'convomem'].includes(bench)) throw new Error('--set locomo | longmemeval | convomem');
    const model = o.model || 'sonnet-5.5';
    const runId = o.runId || `wye-${bench}-${new Date().toISOString().slice(0, 10)}${o.sample ? `-s${o.sample}` : o.limit ? `-l${o.limit}` : ''}`;
    const url = await scratchApp(log);
    const shim = spawn(process.execPath, [path.join(__dirname, 'claude-shim.js'), '--port', SHIM_PORT, '--parallel', String(o.parallel || 6), '--log', path.join(BENCH, `claude-${runId}.jsonl`)], { stdio: ['ignore', 'inherit', 'inherit'] });
    try {
        await waitFor(() => fetch(`http://127.0.0.1:${SHIM_PORT}/`).then(() => true, () => false), 'the claude shim', 10000);
        const args = ['run', 'src/index.ts', 'run', '-p', 'wye', '-b', bench, '-m', model, '-j', model, '-r', runId];
        if (o.sample) args.push('-s', String(o.sample), '--sample-type', 'random'); else if (o.limit) args.push('-l', String(o.limit));
        log(`bun ${args.join(' ')}`);
        const env = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${SHIM_PORT}/v1`, ANTHROPIC_API_KEY: 'answered-by-the-claude-cli', WYE_URL: url, WF_URL: url, WYE_PORT: PORT, WYE_HOME: HOME, WYE_BENCH_DIR: BENCH };
        const code = await new Promise(r => spawn(BUN, args, { cwd: MB, env, stdio: 'inherit' }).on('close', r));
        if (code) throw new Error(`MemoryBench exited ${code} — the run resumes from its checkpoint: wye eval public memorybench --run --set ${bench} --run-id ${runId}`);
        return { runId };
    } finally { shim.kill(); }
}

// the published numbers Wye's are set beside — each with its source, model and what it measures
const PUBLISHED = {
    locomo: {
        source: 'Mem0 paper, arxiv.org/abs/2504.19413, Table 2: LLM-as-a-judge J, gpt-4o-mini answering, adversarial left out',
        overall: { 'Full context': 72.90, 'Mem0g': 68.44, 'Mem0': 66.88, 'Zep': 65.99, 'RAG (best)': 60.97, 'LangMem': 58.10, 'OpenAI memory': 52.90, 'A-Mem': 48.38 },
        types: {},   // Mem0's per-category table numbers LoCoMo's categories differently from the dataset; only the overall row is compared
    },
    longmemeval: {
        source: 'supermemory.ai/research (LongMemEval-S eval report, May 2026): gpt-4o answering and judging; Supermemory labels its headline "Recall@20 with aggregation"; also supermemory with gpt-5 84.6 and gemini-3-pro 85.2',
        overall: { 'Supermemory (gpt-4o)': 97, 'Supermemory (gpt-5)': 84.6, 'Supermemory (gemini-3-pro)': 85.2, 'Zep (gpt-4o)': 71.2, 'Full context (gpt-4o)': 60.2 },
        types: { 'single-session-user': { 'Supermemory': 97, 'Zep': 92.9, 'Full context': 81.4 }, 'single-session-assistant': { 'Supermemory': 100, 'Zep': 80.4, 'Full context': 94.6 }, 'single-session-preference': { 'Supermemory': 95, 'Zep': 56.7, 'Full context': 20 }, 'knowledge-update': { 'Supermemory': 100, 'Zep': 83.3, 'Full context': 78.2 }, 'temporal-reasoning': { 'Supermemory': 95, 'Zep': 62.4, 'Full context': 45.1 }, 'multi-session': { 'Supermemory': 96, 'Zep': 57.9, 'Full context': 44.3 } },
    },
    convomem: { source: 'no per-system ConvoMem numbers are published (Supermemory claims #1 with no table)', overall: {}, types: {} },
};
const NAMES = { locomo: 'LoCoMo', longmemeval: 'LongMemEval-S', convomem: 'ConvoMem' };
const pct = x => x === null || x === undefined ? null : Math.round(x * 1000) / 10;

// the runs of the wye provider: data/runs/<id>/report.json, newest first
function wyeRuns() {
    const dir = path.join(MB, 'data', 'runs'); if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(id => { try { return JSON.parse(fs.readFileSync(path.join(dir, id, 'report.json'), 'utf8')); } catch { return null; } })
        .filter(r => r && r.provider === 'wye' && !/smoke/.test(r.runId)).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}
function reportOf(r) {
    const pub = PUBLISHED[r.benchmark] || { overall: {}, types: {} };
    const h = r.summary.headline || r.summary;
    const ret = r.retrieval || {};
    const rows = [{ name: `${NAMES[r.benchmark] || r.benchmark} overall${r.summary.headline ? ` (without ${r.summary.headline.excludedTypes.join(', ')})` : ''}`, ours: pct(h.accuracy), n: h.totalQuestions, theirs: pub.overall }];
    for (const [t, v] of Object.entries(r.byQuestionType || {})) rows.push({ name: `${NAMES[r.benchmark] || r.benchmark} ${t}`, ours: pct(v.accuracy), n: v.total, theirs: (pub.types || {})[t] || {} });
    const notes = [
        `answering and judging: ${r.answeringModel} / ${r.judge} through the claude CLI (no API key here) — the published rows used ${r.benchmark === 'locomo' ? 'gpt-4o-mini' : 'gpt-4o'}; set beside them, not equal to them`,
        `retrieval@${ret.k || 10}: hit ${pct(ret.hitAtK)}%, recall ${pct(ret.recallAtK)}%, MRR ${ret.mrr !== undefined ? ret.mrr.toFixed(2) : 'n/a'}, NDCG ${ret.ndcg !== undefined ? ret.ndcg.toFixed(2) : 'n/a'} (an LLM marks each hit relevant)`,
        `latency median: search ${r.latency.search.median} ms; context ${r.tokens.avgContextTokens} tokens per question; memscore ${r.memscore}`,
        `all questions${r.summary.headline ? ' with adversarial' : ''}: ${pct(r.summary.accuracy)}% of ${r.summary.totalQuestions}`,
        `MemoryBench ${PIN}, run ${r.runId}, ${r.timestamp}; Wye: each session a dated page in a new vault (wye init, wye import --no-analyse), searched with wye ask-search --rerank (no language model)`,
    ];
    return { title: `MemoryBench — ${NAMES[r.benchmark] || r.benchmark}, Wye retrieval mode`, source: `${SOURCE}; published: ${pub.source}`, published: pub.source, rows, notes };
}

async function run(opts) {
    const log = opts.log || (m => console.error('memorybench: ' + m));
    if (opts.fetch) return { fetched: fetchAll(log) };
    if (opts.runIt) { const { runId } = await runIt(opts, log); opts = { ...opts, reportIt: true, only: runId }; }
    if (opts.reportIt) {
        const runs = wyeRuns().filter(r => !opts.only || r.runId === opts.only); if (!runs.length) return { reports: [] };
        const P = loadProduct('wye'); const out = [];
        const latest = new Map(); for (const r of runs) if (!latest.has(r.benchmark)) latest.set(r.benchmark, r);
        for (const r of latest.values()) {
            const report = reportOf(r);
            const { file } = writeResult(P.productDir, `public-memorybench-${r.benchmark}`, { gitSha: P.gitSha, live: true, model: r.answeringModel, judge: { model: r.judge }, scores: { [`memorybench.${r.benchmark}`]: { value: (r.summary.headline || r.summary).accuracy, n: (r.summary.headline || r.summary).totalQuestions } }, runs: [], meta: { runId: r.runId, retrieval: r.retrieval, latency: r.latency, tokens: r.tokens }, report }, { baseline: 'public benchmarks are not gated' });
            out.push({ report, file });
        }
        return { reports: out };
    }
    throw new Error('wye eval public memorybench --fetch | --run --set locomo|longmemeval|convomem [--sample n] [--limit n] | --report');
}
function print(r) {
    if (r.fetched) { console.log(`MemoryBench at ${r.fetched.commit} in ${r.fetched.repo}, with the wye provider`); return; }
    if (!r.reports || !r.reports.length) { console.log('no memorybench run yet — --fetch, then --run --set locomo'); return; }
    for (const { report, file } of r.reports) {
        console.log(`\n${report.title}`);
        for (const row of report.rows) console.log(`  ${row.name}: Wye ${row.ours === null ? 'n/a' : row.ours + '%'} (n=${row.n})${Object.keys(row.theirs).length ? '\n' + Object.entries(row.theirs).map(([k, v]) => `    ${k.padEnd(28)} ${v}%`).join('\n') : ''}`);
        for (const n of report.notes) console.log(`  · ${n}`);
        console.log(`  published: ${report.published}\n  written ${file}`);
    }
}

module.exports = { run, print, fetchAll, patch, runIt, scratchApp, reportOf, wyeRuns, MB, BENCH, SOURCE, PIN, PUBLISHED };
