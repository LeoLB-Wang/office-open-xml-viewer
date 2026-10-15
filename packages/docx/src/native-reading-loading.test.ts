import { describe, expect, it, vi } from 'vitest';
import type { AcquiredParagraphLayoutInput, DocumentLayout } from './layout/types.js';
import type { DocParagraph, DocxDocumentModel } from './types.js';
import type { ParagraphAcquisitionInput } from './layout/text.js';

describe('optional reading runtime', () => {
  it('binds an isolated sidecar to renderer-owned seals, planners and image sessions', async () => {
    vi.resetModules();
    const { readingHooks } = await import('./internal/reading-hooks.js');
    const { readingPaintHooks } = await import('./paint/reading-hooks.js');
    const { nativeReadingOwners: owners } = await import('./internal/native-reading-owners.js');
    const { readingPaintOwners: paintOwners } = await import('./paint/reading-owners.js');
    const { createPaintResourceRegistry } = await import('./layout/paint-resources.js');
    const { createPaintResourceSession } = await import('./paint/resource-session.js');
    const registry = createPaintResourceRegistry([{
      kind: 'image', resourceKey: 'reading-image', partPath: 'reading.png', mimeType: 'image/png',
      intrinsicSize: { widthPt: 40, heightPt: 20 },
    }]);
    const paragraph = owners.snapshotPlainData({ runs: [{
      type: 'anchorHost', anchorOccurrenceId: 'reading-anchor',
    }, {
      type: 'image', imagePath: 'reading.png', mimeType: 'image/png', widthPt: 40, heightPt: 20,
      anchorAcquisitionInput: {
        occurrenceId: 'reading-anchor', nativeReadingRelocation: 'completeScene', group: null,
        extent: { widthPt: 40, heightPt: 20, widthStatus: 'valid', heightStatus: 'valid' },
        relativeSize: { horizontal: null, vertical: null }, wrap: { kind: 'tight', polygon: null },
      },
    }] }, 'reading worker paragraph');
    // Isolate every sidecar module, as the self-contained production ESM does.
    vi.resetModules();
    const { installNativeReadingRuntime } = await import('./internal/native-reading-runtime.js');
    const { imageResourceKey } = await import('./layout/source-key.js');
    const source = { story: 'body' as const, storyInstance: 'body', path: [0] };
    const key = imageResourceKey({ ...source, path: [0, 1] }, 'reading.png');
    const descriptor = { ...registry.descriptors[0], resourceKey: key };
    const rendererRegistry = createPaintResourceRegistry([descriptor]);
    installNativeReadingRuntime({ readingHooks, readingPaintHooks, owners, paintOwners });
    const scenes = readingHooks.scenes(paragraph as unknown as ParagraphAcquisitionInput,
      source, 'p', 'body', rendererRegistry);
    expect(scenes).toHaveLength(1);
    expect(owners.isDeepFrozenPlainDataRoot(scenes[0])).toBe(true);
    const drawing = scenes[0].drawing;
    const command = drawing.commands[0];
    if (command.kind !== 'resource' || !command.nativeImagePlan) throw new Error('reading image lost');
    const plan = command.nativeImagePlan;
    const session = createPaintResourceSession(rendererRegistry, [{
      kind: 'image', resourceKey: key, handle: { width: 100, height: 80 },
    }]);
    const { assertNativeReadingImageAvailable } = await import('./paint/native-reading-image-availability.js');
    // A renderer session must pass ownership, then fail the distinct immutable
    // bitmap gate. A structural copy must still fail the ownership gate.
    expect(() => assertNativeReadingImageAvailable(session, plan, command.rect))
      .toThrow('available immutable');
    expect(() => assertNativeReadingImageAvailable({ ...session }, plan, command.rect))
      .toThrow('realm-owned');

    const vector = owners.snapshotPlainData({ runs: [paragraph.runs[0], {
      type: 'shape', presetGeometry: 'rect', subpaths: [], fill: { fillType: 'solid', color: '000000' },
      anchorAcquisitionInput: {
        ...paragraph.runs[1].anchorAcquisitionInput,
        group: {
          sourceIndex: 0, sourceCount: 1, childSourceId: 'reading-child',
          transformChain: [], childTransform: null,
          resolvedChildFrame: { offsetXPt: 0, offsetYPt: 0, widthPt: 40, heightPt: 20,
            rotationDeg: 0, flipH: false, flipV: false },
        },
      },
    }] }, 'reading worker group') as unknown as ParagraphAcquisitionInput;
    expect(readingHooks.scenes(vector, source, 'p', 'body', undefined, 2000)).toHaveLength(1);
    // The shared planner throws the renderer's error class, not the sidecar's
    // independently bundled constructor. Budget classification must survive.
    expect(() => readingHooks.scenes(vector, source, 'p', 'body', undefined, 5))
      .toThrow(expect.objectContaining({ blocker: 'budget' }));
  }, 30000);

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
