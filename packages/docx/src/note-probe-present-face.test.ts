import { describe, expect, it } from 'vitest';
import { buildSegments, layoutLines } from './line-layout.js';
import { createLayoutServices } from './layout-runtime.js';
import type { DocRun, DocxDocumentModel } from './types.js';

// A zero-ink custom note-mark host probes its painting face only when its face
// has no line metric (an absent authored face). A present face keeps its
// established metric-only geometry, including authored baseline positions.
const ctx = {
  font: '10px serif', letterSpacing: '0px', fontKerning: 'none',
  measureText(text: string) {
    return { width: text.length * 5, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 } as TextMetrics;
  },
} as unknown as CanvasRenderingContext2D;
const model = {
  section: { pageWidth: 612, pageHeight: 792, marginTop: 72, marginRight: 72, marginBottom: 72, marginLeft: 72,
    headerDistance: 36, footerDistance: 36, titlePage: false, evenAndOddHeaders: false },
  body: [], headers: { default: null, first: null, even: null }, footers: { default: null, first: null, even: null },
} as unknown as DocxDocumentModel;

describe('custom note-mark host metric probe', () => {
  it('keeps present custom-note hosts on their metric-only geometry', () => {
    for (const position of [0, 2]) {
      const services = createLayoutServices(model, { measureContext: ctx, localMetrics: { arial: {
        requestedFamily: 'Arial', family: 'Arial', weight: 400, style: 'normal', sourceIdentity: 'office-local:arial',
        lineHeightRatio: 1.15, designAscentRatio: 0.9, designDescentRatio: 0.25,
      } } });
      const run = { type: 'text', text: '', fontFamily: 'Arial', fontSize: 10, bold: false, italic: false, position,
        noteRef: { kind: 'footnote', id: '1', customMarkFollows: true } } as unknown as DocRun;
      const segs = buildSegments([run], { pageIndex: 0, totalPages: 1, layoutServices: services });
      expect(segs.every((segment) => !('metricProbeText' in segment) || segment.metricProbeText === undefined)).toBe(true);
      const withoutProbe = segs.map((segment) => ({ ...segment, metricProbeText: undefined }));
      const geometry = (line: { ascent: number; descent: number }) => ({ ascent: line.ascent, descent: line.descent });
      expect(geometry(layoutLines(ctx, segs, 100, 0, 1)[0]!)).toEqual(geometry(layoutLines(ctx, withoutProbe, 100, 0, 1)[0]!));
    }
  });
});
