import { describe, it, expect } from 'vitest';
import { pickDrop } from './cleanup';

// req:waterfall.card-quality.cleanup
describe('pickDrop', () => {
  const c = (id: string, status: string, links = 0, file = 'a.md', line = 1) => ({ id, status, links, file, line });
  it('drops the proposed copy of an approved card', () => { expect(pickDrop(c('x', 'approved'), c('y', 'proposed', 5)).id).toBe('y'); });
  it('then the one fewer blocks link to', () => { expect(pickDrop(c('x', 'proposed', 3), c('y', 'proposed', 1)).id).toBe('y'); });
  it('then the later one', () => { expect(pickDrop(c('x', 'proposed', 0, 'a.md', 9), c('y', 'proposed', 0, 'a.md', 2)).id).toBe('x'); });
});
