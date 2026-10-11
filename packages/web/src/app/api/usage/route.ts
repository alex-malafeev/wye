import { NextResponse } from 'next/server';
import { claudeUsage, codexUsage, POLL_MS } from '@/lib/usage';
import { CAP_GB, usedBytes } from '@/lib/memory-guard';

export const dynamic = 'force-dynamic';

// GET → what the status bar shows (decision:waterfall.status-bar-memory-and-limits): this server's memory against
// its cap, and the agents' plan windows — fetched from the vendors at most once per POLL_MS for every tab together.
export async function GET() {
  const u = process.memoryUsage();
  const [claude, codex] = await Promise.all([claudeUsage(), codexUsage()]);
  return NextResponse.json({ memory: { used: usedBytes(u), rss: u.rss, heapUsed: u.heapUsed, external: u.external, capGb: CAP_GB, pid: process.pid, uptime: Math.round(process.uptime()) }, agents: [claude, codex], pollMs: POLL_MS });
}
