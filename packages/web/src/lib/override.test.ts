import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { overrideOf, writeAtomic } from './write';

// req:waterfall.global-skills.override — a shipped document is never written: the edit lands in the project's .wye/
describe('override of a shipped document', () => {
  it('maps _build/shipped/<project>/<doc> to projects/<project>/.wye/<doc>, and nothing else', () => {
    expect(overrideOf('/v/.wye/_build/shipped/app/skill-remember.md')).toBe('/v/.wye/projects/app/.wye/skill-remember.md');
    expect(overrideOf('/v/.wye/projects/app/.wye/skill-remember.md')).toBeNull();
    expect(overrideOf('/v/.wye/_build/graph.json')).toBeNull();
  });
  it('writeAtomic to a shipped file writes the copy and leaves the shipped file as it was', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wye-override-'));
    const shipped = path.join(root, '_build/shipped/app/skill-x.md');
    await mkdir(path.dirname(shipped), { recursive: true }); await writeFile(shipped, 'shipped');
    await writeAtomic(shipped, 'edited');
    expect(await readFile(shipped, 'utf8')).toBe('shipped');
    expect(await readFile(path.join(root, 'projects/app/.wye/skill-x.md'), 'utf8')).toBe('edited');
    expect((await readdir(path.join(root, 'projects/app/.wye'))).length).toBe(1);
  });
});
