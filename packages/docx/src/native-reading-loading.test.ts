import { describe, expect, it, vi } from 'vitest';
import type { AcquiredParagraphLayoutInput, DocumentLayout } from './layout/types.js';
import type { DocParagraph, DocxDocumentModel } from './types.js';

describe('optional reading runtime', () => {
  it('accepts absent and explicitly empty picture-bullet provenance in a cold realm', async () => {
    vi.resetModules();
    const { paragraphAcquisitionInput } = await import('./parser-model.js');
    const source = { story: 'body' as const, storyInstance: 'body', path: [0] };
    const numbering = { numId: 1, level: 0, format: 'decimal', text: '1.', indentLeft: 0, tab: 0, suff: 'space' };
    for (const value of [null, undefined, numbering, { ...numbering, __nativeReadingPictureBullet: undefined },
      { ...numbering, __nativeReadingPictureBullet: null }]) {
      const paragraph = { type: 'paragraph', runs: [], numbering: value } as unknown as DocParagraph;
      expect(paragraphAcquisitionInput(paragraph, source).nativeReadingPictureBullet).toBeUndefined();
    }
  }, 30000);

  it('preserves ordinary empty hook results across source activation and rejects malformed absence', async () => {
    vi.resetModules();
    const { readingHooks } = await import('./internal/reading-hooks.js');
    const { paragraphAcquisitionInput } = await import('./parser-model.js');
    const { layoutSourceStore } = await import('./layout-source-model-adapter.js');
    const source = { story: 'body' as const, storyInstance: 'body', path: [0] };
    const paragraph = { type: 'paragraph', runs: [], numbering: null } as unknown as DocParagraph;
    const acquired = paragraphAcquisitionInput(paragraph, source);
    const store = layoutSourceStore({ body: [paragraph] } as DocxDocumentModel);
    const layout: DocumentLayout = { pages: [], diagnostics: [] };
    const input = {} as AcquiredParagraphLayoutInput; // The no-op contract preserves identity without reading layout.
    const frame = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 };
    const ordinaryResults = () => ({
      wordBreaking: readingHooks.wordBreaking(undefined),
      requests: readingHooks.requests(store),
      requested: readingHooks.requested(store),
      notices: readingHooks.notices(layout),
      retained: [readingHooks.retainNotices(undefined), readingHooks.retainNotices([])],
      occurrences: readingHooks.occurrences(acquired),
      anchorRuns: [...readingHooks.anchorRuns(store.bodyLayoutInput, () => acquired)],
      scenes: readingHooks.scenes(acquired, source, 'p', 'body', undefined),
    });
    const cold = ordinaryResults();
    expect(readingHooks.appendScenes(acquired, input, frame, undefined)).toBe(input);
    for (const value of [null, {}, []]) {
      expect(() => readingHooks.wordBreaking(value)).toThrow();
      if (!Array.isArray(value)) expect(() => readingHooks.retainNotices(value as never)).toThrow();
    }
    (await import('./internal/native-reading-runtime.js')).installNativeReadingRuntime();
    expect(ordinaryResults()).toEqual(cold);
    expect(readingHooks.appendScenes(acquired, input, frame, undefined)).toBe(input);
    for (const value of [null, {}, []]) {
      expect(() => readingHooks.wordBreaking(value)).toThrow();
      if (!Array.isArray(value)) expect(() => readingHooks.retainNotices(value as never)).toThrow();
    }
    expect(readingHooks.wordBreaking({ rawHres: 0, rawChHres: 1 }))
      .toEqual({ rawHres: 0, rawChHres: 1 });
  }, 30000);
});
