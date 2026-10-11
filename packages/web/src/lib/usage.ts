// The agents' plan limits for the status bar (decision:waterfall.status-bar-memory-and-limits): what Claude Code's
// /usage and Codex's /status show — the 5-hour and weekly windows, per-model ones when the plan has them — read
// from the same endpoints with this machine's own logins. Claude: the OAuth token Claude Code keeps (the macOS
// keychain, else ~/.claude/.credentials.json) against api.anthropic.com/api/oauth/usage; Codex: ~/.codex/auth.json
// against chatgpt.com/backend-api/wham/usage. The Claude endpoint rate-limits hard (429 for minutes under a wrong
// User-Agent or more than one call every ~3 min), so one fetch per POLL_MS serves every open tab, and a failure is
// kept for the same time rather than retried.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export type UsageWindow = { label: string; percent: number; resetsAt?: string };
export type AgentUsage = { agent: 'claude' | 'codex'; plan?: string; windows: UsageWindow[]; error?: string; at: string };

export const POLL_MS = 3 * 60_000;

// ---- parsers (pure)

type ClaudeLimit = { kind?: string; group?: string; percent?: number; resets_at?: string; scope?: { model?: { id?: string | null; display_name?: string | null } | null; surface?: string | null } | string | null; is_active?: boolean };
type ClaudeUsageJson = { five_hour?: { utilization?: number; resets_at?: string } | null; seven_day?: { utilization?: number; resets_at?: string } | null; limits?: ClaudeLimit[] | null } & Record<string, unknown>;
// The windows: the session (5h) and the weekly one, then every other limit the plan has — a weekly cap scoped to a
// model (kind weekly_scoped, the model's display name as the label), else what the kind says after its group.
export function parseClaudeUsage(j: ClaudeUsageJson): UsageWindow[] {
  const out: UsageWindow[] = [];
  const seen = new Set<string>();
  const scoped = (l: ClaudeLimit) => typeof l.scope === 'string' ? l.scope : l.scope?.model?.display_name || l.scope?.model?.id || l.scope?.surface || '';
  const label = (l: ClaudeLimit) => l.kind === 'session' ? '5h' : l.kind === 'weekly_all' ? 'week' : (scoped(l) || (l.kind ?? '').replace(/^weekly_/, '').replace(/_/g, ' ') || l.group || 'limit');
  for (const l of j.limits ?? []) { if (typeof l.percent !== 'number') continue; const lab = label(l); if (seen.has(lab)) continue; seen.add(lab); out.push({ label: lab, percent: Math.round(l.percent), resetsAt: l.resets_at }); }
  if (!seen.has('5h') && typeof j.five_hour?.utilization === 'number') out.unshift({ label: '5h', percent: Math.round(j.five_hour.utilization), resetsAt: j.five_hour.resets_at });
  if (!seen.has('week') && typeof j.seven_day?.utilization === 'number') out.splice(1, 0, { label: 'week', percent: Math.round(j.seven_day.utilization), resetsAt: j.seven_day.resets_at });
  return out;
}
type CodexWindow = { used_percent?: number; limit_window_seconds?: number; reset_at?: number };
type CodexUsageJson = { plan_type?: string; rate_limit?: { primary_window?: CodexWindow | null; secondary_window?: CodexWindow | null } | null };
const spanLabel = (s?: number) => !s ? 'limit' : s <= 6 * 3600 ? `${Math.round(s / 3600)}h` : s <= 8 * 86400 ? 'week' : `${Math.round(s / 86400)}d`;
export function parseCodexUsage(j: CodexUsageJson): { plan?: string; windows: UsageWindow[] } {
  const windows: UsageWindow[] = [];
  for (const w of [j.rate_limit?.primary_window, j.rate_limit?.secondary_window]) if (w && typeof w.used_percent === 'number') windows.push({ label: spanLabel(w.limit_window_seconds), percent: Math.round(w.used_percent), resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : undefined });
  return { plan: j.plan_type, windows };
}

// ---- the logins this machine has

async function claudeToken(): Promise<{ token: string; plan?: string } | null> {
  const read = (raw: string) => { const j = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number; subscriptionType?: string } }; const o = j.claudeAiOauth; if (!o?.accessToken) return null; if (o.expiresAt && o.expiresAt < Date.now()) return null; return { token: o.accessToken, plan: o.subscriptionType }; };
  if (process.platform === 'darwin') {
    const raw = await new Promise<string>(res => execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (e, out) => res(e ? '' : String(out).trim())));
    if (raw) { try { const t = read(raw); if (t) return t; } catch { /* not json */ } }
  }
  try { const t = read(await readFile(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json'), 'utf8')); if (t) return t; } catch { /* no file */ }
  return null;
}
async function codexAuth(): Promise<{ token: string; account?: string } | null> {
  try {
    const j = JSON.parse(await readFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), 'utf8')) as { tokens?: { access_token?: string; account_id?: string } };
    return j.tokens?.access_token ? { token: j.tokens.access_token, account: j.tokens.account_id } : null;
  } catch { return null; }
}
const claudeVersion = () => new Promise<string>(res => execFile('claude', ['--version'], { timeout: 5000 }, (e, out) => res(e ? '2.0.0' : String(out).trim().split(' ')[0] || '2.0.0')));

// ---- the fetches, one per poll window for the whole app

async function fetchClaude(): Promise<AgentUsage> {
  const at = new Date().toISOString();
  const cred = await claudeToken(); if (!cred) return { agent: 'claude', windows: [], error: 'not signed in', at };
  const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': `claude-code/${await claudeVersion()}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return { agent: 'claude', plan: cred.plan, windows: [], error: r.status === 429 ? 'rate limited — again in a few minutes' : `HTTP ${r.status}`, at };
  return { agent: 'claude', plan: cred.plan, windows: parseClaudeUsage(await r.json()), at };
}
async function fetchCodex(): Promise<AgentUsage> {
  const at = new Date().toISOString();
  const auth = await codexAuth(); if (!auth) return { agent: 'codex', windows: [], error: 'not signed in', at };
  const r = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers: { Authorization: `Bearer ${auth.token}`, ...(auth.account ? { 'ChatGPT-Account-Id': auth.account } : {}), 'User-Agent': 'codex-cli', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return { agent: 'codex', windows: [], error: r.status === 401 ? 'sign-in expired' : `HTTP ${r.status}`, at };
  const { plan, windows } = parseCodexUsage(await r.json());
  return { agent: 'codex', plan, windows, at };
}

type Cache = { claude?: { at: number; p: Promise<AgentUsage> }; codex?: { at: number; p: Promise<AgentUsage> } };
const cache = ((globalThis as unknown as { __wfUsage?: Cache }).__wfUsage ??= {});
function cached(key: 'claude' | 'codex', fn: () => Promise<AgentUsage>): Promise<AgentUsage> {
  const hit = cache[key];
  if (hit && Date.now() - hit.at < POLL_MS) return hit.p;
  const p = fn().catch((e: Error) => ({ agent: key, windows: [], error: e.message.slice(0, 80), at: new Date().toISOString() } as AgentUsage));
  cache[key] = { at: Date.now(), p };
  return p;
}
export const claudeUsage = () => cached('claude', fetchClaude);
export const codexUsage = () => cached('codex', fetchCodex);
