import { describe, expect, it } from 'vitest';
import { measureLocalFontNormalLine } from './local-line-metrics.js';

function environment(height = 2355) {
  let reads = 0;
  let removed = 0;
  const probe = {
    style: { cssText: '' }, textContent: '',
    get offsetHeight() { reads++; return height; },
    remove() { removed++; },
  };
  const fonts = {} as FontFaceSet;
  const document = {
    fonts,
    body: { append() {} },
    createElement: () => probe,
  } as unknown as Document;
  const context = {
    font: '12px serif',
    measureText: () => ({ fontBoundingBoxAscent: 1825, fontBoundingBoxDescent: 443 }) as TextMetrics,
  };
  return { document, fonts, context, probe, reads: () => reads, removed: () => removed };
}

describe('prepared local-face normal line measurement', () => {
  it('retains the host line gap once per loaded resource, using its exact paint alias', () => {
    const env = environment();
    const face = { family: 'isolated-face', weight: '400', style: 'normal', status: 'loaded' } as FontFace;
    const first = measureLocalFontNormalLine(face, env.fonts, env.context, 2048, env.document);
    expect(first).toEqual({ ascentRatio: 1825 / 2048, descentRatio: 443 / 2048, lineGapRatio: 87 / 2048 });
    expect(measureLocalFontNormalLine(face, env.fonts, env.context, 2048, env.document)).toBe(first);
    expect(env.reads()).toBe(1);
    expect(env.removed()).toBe(1);
    expect(env.probe.style.cssText).toContain('"isolated-face"');
    expect(env.context.font).toBe('12px serif');
    // An equal alias in another registration must not reuse this resource's gap.
    const other = environment(2268);
    expect(measureLocalFontNormalLine({ ...face } as FontFace, other.fonts, other.context, 2048, other.document)?.lineGapRatio).toBe(0);
  });

  it('declines unavailable, foreign-realm and invalid measurements', () => {
    const face = { family: 'isolated-face', weight: '400', style: 'normal', status: 'loaded' } as FontFace;
    const env = environment(Number.NaN);
    expect(measureLocalFontNormalLine(face, env.fonts, env.context, 2048, env.document)).toBeNull();
    expect(env.removed()).toBe(1);
    expect(measureLocalFontNormalLine(face, {} as FontFaceSet, env.context, 2048, env.document)).toBeNull();
    expect(measureLocalFontNormalLine(face, env.fonts, env.context, 2048, null)).toBeNull();
  });
});
