// The pages the app writes into every product (lib/doc SYSTEM_DIR): Goals and Work (lib/pr-docs SYSTEM_VIEWS), Hooks,
// Skills (decision:wf2.hooks-and-skills) — the base skills and workflows under it are rendered from the install by each build. They live in the project that
// holds PRs (else the first) and are written the first time the product is shown. A page written just now is not in
// the graph yet, so the product is built before anything renders it — or the rail's Goals and Work of a new product
// lead to "Page not found" until something else builds it.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isSystemSlug } from './doc';
import { prsPageId } from './pr-doc';
import { SYSTEM_VIEWS, ensureViewPages, viewPageId } from './pr-docs';
import { ensureHooksPage, ensureSkillsPage, hooksPageId, skillsPageId } from './skills';
import { loadScope, treeFor, type Scope } from './scope';
import { rebuild } from './write';

export const viewProjectOf = (s: Scope) => s.projects.find(p => s.graph.modules.some(m => m.id === prsPageId(p.slug))) ?? s.projects[0];
// the page a new top-level page goes under: the project's main document, unless that is an app-written one
export function mainOf(s: Scope, p: ReturnType<typeof viewProjectOf>): string | null {
  if (!p) return null; const t = treeFor(s, p.slug); return t.main && !isSystemSlug(t.main.slug) ? t.main.module.id : null;
}

// Writes what is missing and answers the scope to render: the same one, or a fresh one after a build when a page was
// written now — or is on disk and still not in the graph (written by a request that was still building when this one
// read the graph). A read-only tree writes nothing and builds nothing.
export async function ensureSystemPages(scope: Scope): Promise<Scope> {
  const p = viewProjectOf(scope); if (!p) return scope;
  let wrote = false;
  try {
    const m = mainOf(scope, p);
    // the Skills and Hooks pages only: the skills, workflows and hooks under them come from the install with each build
    // (lib/shipped — decision:waterfall.skills-read-from-install-overrides-on-edit), never copied in
    const views = await ensureViewPages(p); await ensureHooksPage(p, m); await ensureSkillsPage(p, m);
    wrote = views.length > 0;
  } catch { /* read-only tree */ }
  const pages: [string, string][] = [...SYSTEM_VIEWS.map(v => [viewPageId(p.slug, v.slug), `${v.slug}.md`] as [string, string]), [hooksPageId(p.slug), 'hooks.md'], [skillsPageId(p.slug), 'skills.md']];
  const known = new Set(scope.graph.modules.map(m => m.id));
  const unbuilt = async () => { for (const [id, file] of pages) if (!known.has(id) && await stat(path.join(p.wyeDir, file)).then(() => true, () => false)) return true; return false; };
  if (!wrote && !await unbuilt()) return scope;
  await rebuild(scope.product.dir);
  return (await loadScope(scope.product.slug, scope.project?.slug)) ?? scope;
}
