import { describe, it, expect } from 'vitest';
import { keywords, nodeText } from './semantic';

describe('keywords', () => {
  it('drops stop words and short tokens, keeps ids and code names', () => {
    expect(keywords('The outbox accepts only operational kinds (orderUpsert) for entity:offline.outbox')).toEqual(['outbox', 'accepts', 'only', 'operational', 'kinds', 'orderupsert', 'entity:offline.outbox']);
  });
});
describe('nodeText', () => {
  it('joins the title with prose fields and strips markdown', () => {
    const n = { id: 'rule:x', kind: 'rule', title: 'Always on', status: '', section: '', subsection: '', body: 'id: rule:x\nstatement: The [engine](entity:e) **never** uploads.\nsource: f.ts', defined: true, file: '', line: 0 };
    expect(nodeText(n)).toBe('Always on. The engine never uploads.');
  });
});

describe('stored vectors', () => {
  it('Int8 round trip keeps the cosine to within a hundredth, and old decimal arrays still read', async () => {
    const { packVec, unpackVec } = await import('./semantic');
    const a = Array.from({ length: 384 }, (_, i) => Math.sin(i * 1.7) * 0.1), b = Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.9) * 0.1);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    const ra = unpackVec({ id: 'a', hash: 'h', ...packVec(a) }), rb = unpackVec({ id: 'b', hash: 'h', ...packVec(b) });
    expect(Math.abs(dot(ra, rb) - dot(a, b))).toBeLessThan(0.01 * Math.sqrt(dot(a, a) * dot(b, b)));
    expect(unpackVec({ id: 'a', hash: 'h', vec: [0.1, -0.2] })).toEqual([0.1, -0.2]);
    expect(packVec(a).q.length).toBe(512);
  });
});
