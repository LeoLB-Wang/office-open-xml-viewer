import { loadPreviousPainters, type PreviousPainters } from '../../../tests/helpers/previous-painters';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { paintDrawingMLShape, resolveFill, trackPaintPath, withInheritedPatternScope,
  withPatternCoordinateSpace, type Stroke, type DrawingMLShapeGeometry } from '@silurus/ooxml-core';
import { withPatternPointScale } from '../../core/src/shape/paint';
import { renderSlide } from '../../pptx/src/renderer';
import { renderViewport } from '../../xlsx/src/renderer';
import type { Slide } from '@silurus/ooxml-pptx';
import type { Styles, Worksheet } from '@silurus/ooxml-xlsx';
import { loadSkiaForTests } from './test-imports';

const skia = await loadSkiaForTests();
const stops = [{ position: 0, color: '112233' }, { position: 1, color: 'DDEEFF' }];
type DecorationFill = NonNullable<Stroke['fill']>;
const fills: Record<string, DecorationFill> = {
  pattern: { fillType: 'pattern', preset: 'pct50', fg: 'FF0000', bg: '0000FF' },
  solid: { fillType: 'solid', color: '5478AB' },
  linear: { fillType: 'gradient', gradType: 'linear', angle: 25, stops },
  circle: { fillType: 'gradient', gradType: 'radial', path: 'circle', angle: 0,
    fillToRect: { l: .1, r: .5, t: .4, b: .1 }, stops },
  tiledLinear: { fillType: 'gradient', gradType: 'linear', angle: 25, stops, tileRect: { r: .5 } },
  tiledCircle: { fillType: 'gradient', gradType: 'radial', path: 'circle', angle: 0,
    fillToRect: { l: .1, r: .5, t: .4, b: .1 }, stops, tileRect: { r: .5 } },
};

// Compare every decoded pixel with the pinned production renderer running on
// this host. This protects paint frames and format wiring without treating one
// platform's native Skia output as a portable Office-fidelity reference.
// Connector tests include a filled triangle; custom paths have an open arrow.
// XLSX has no line decorations, so its integration covers the rightArrow body.
//
// Line ends follow the Office-measured size rule (core arrow-geometry.ts),
// which main predates. Connector cases therefore give main a stroke whose
// head has the same outline (main: 4 × 25 px sm; now: 5 × 20 px lg — a 100 px
// triangle with no shaft left after retraction), so every pixel still compares.
// The custom open arrow cannot be matched. There main draws its old lg
// triangle (same tip frame) instead: shaft pixels beyond both heads must
// match, and inside the new arms the head brush must match main's head
// brush wherever main's triangle covers them.
const routes = ['core-connector', 'core-custom', 'core-body', 'pptx-connector', 'pptx-custom', 'xlsx-body'];

async function renderCase(route: string, fill: DecorationFill, painters: Pick<PreviousPainters, 'paintDrawingMLShape' | 'renderSlide' | 'renderViewport'>, main = false): Promise<Uint8ClampedArray> {
  const c = new (skia as NonNullable<typeof skia>).Canvas(400, 400);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  const body = route.endsWith('body');
  const custom = route.endsWith('custom');
  const rect = body ? { x: 130, y: 140, w: 150, h: 100 } : custom ? { x: 50, y: 200, w: 300, h: 1 } : { x: 200, y: 200, w: 50, h: 1 };
  const geometry: DrawingMLShapeGeometry = custom ? { kind: 'custom', subpaths: [[
    { cmd: 'moveTo', x: 0, y: 0 }, { cmd: 'lineTo', x: 1, y: 1 },
  ]] } : { kind: 'preset', name: body ? 'rightArrow' : 'line', adjustments: [] };
  const size = main && !custom ? 'sm' as const : 'lg' as const;
  const stroke = { color: '000000', width: main && !custom && !body ? 25 : 20, fill,
    ...(body ? {} : { tailEnd: { type: custom && !main ? 'arrow' as const : 'triangle' as const, w: size, len: size } }),
  };
  if (route.startsWith('core')) {
    // Retained DOCX drawing commands enter this same shared production painter.
    painters.paintDrawingMLShape(ctx, { rect, geometry, fill: body ? fill : null, stroke,
      transform: { rotationDeg: 30, flipH: false, flipV: false } }, 1);
  } else if (route.startsWith('pptx')) {
    await painters.renderSlide(c as unknown as HTMLCanvasElement, {
      index: 0, slideNumber: 1, background: null, elements: [{ type: 'shape',
        x: rect.x * 9525, y: rect.y * 9525, width: rect.w * 9525, height: rect.h * 9525,
        rotation: 30, flipH: false, flipV: false, geometry: 'line', fill: null,
        stroke: { ...stroke, width: stroke.width * 9525 }, textBody: null,
        custGeom: geometry.kind === 'custom' ? geometry.subpaths : null, shadow: null,
      }],
    } as Slide, 400 * 9525, 400 * 9525, { width: 400, dpr: 1 });
  } else {
    painters.renderViewport(ctx, {
      name: 'Sheet1', isChartSheet: true, rows: [], colWidths: {}, rowHeights: {},
      freezeRows: 0, freezeCols: 0, defaultColWidth: 8.43, defaultRowHeight: 15,
      mergeCells: [], conditionalFormats: [], images: [], charts: [],
      defaultFontFamily: 'Calibri', defaultFontSize: 11,
      shapeGroups: [{ fromCol: 0, fromRow: 0, fromColOff: rect.x * 9525, fromRowOff: rect.y * 9525,
        toCol: 1, toRow: 1, toColOff: 0, toRowOff: 0, editAs: 'oneCell',
        nativeExtCx: rect.w * 9525, nativeExtCy: rect.h * 9525,
        shapes: [{ x: 0, y: 0, w: 1, h: 1, rot: 30, strokeWidth: 20,
          strokeColor: '000000', strokeFill: fill, fill,
          geom: { type: 'preset', name: 'rightArrow', adj: [] } }],
      }],
    } as Worksheet, { fonts: [], fills: [], borders: [], cellXfs: [], numFmts: [], dxfs: [] } as Styles,
    { row: 1, col: 1, rows: 1, cols: 1 });
  }
  return ctx.getImageData(0, 0, 400, 400).data;
}

describe.skipIf(!skia)('non-path-gradient paints retain main frames on rotated decorations and shapes', () => {
  let previous: PreviousPainters;
  beforeAll(async () => {
    vi.stubGlobal('OffscreenCanvas', (skia as NonNullable<typeof skia>).Canvas);
    previous = await loadPreviousPainters();
  }, 60000);
  afterAll(() => vi.unstubAllGlobals());
  it.each(routes)('%s retains pattern/solid/linear/circle and tiled native pixels', async route => {
    const current = { paintDrawingMLShape, renderSlide, renderViewport };
    for (const [name, fill] of Object.entries(fills)) {
      const now = await renderCase(route, fill, current), main = await renderCase(route, fill, previous, true);
      if (!route.endsWith('custom')) { expect(now, `${route}/${name}`).toEqual(main); continue; }
      // Tail tip of the 300 px path rotated 30° about its centre. Main's lg
      // triangle reaches ~179 px from it, the new open arrow ~127 px. Beyond
      // both, only the shaft remains. The heads add to the brush's raster
      // coverage box, which resamples the same host-frame pattern/gradient by
      // up to two levels. Compare premultiplied colour, because
      // unpremultiplied edge pixels amplify that at low alpha.
      const u = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) }, n = { x: -u.y, y: u.x };
      const tip = { x: 200 + 150 * u.x, y: 200.5 + 150 * u.y };
      const pm = (d: Uint8ClampedArray, i: number, k: number) => k === 3 ? d[i + 3] : d[i + k] * d[i + 3] / 255;
      const delta = (i: number) => Math.max(...[0, 1, 2, 3].map(k => Math.abs(pm(now, i, k) - pm(main, i, k))));
      const solid = (d: Uint8ClampedArray, x: number, y: number) => [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => {
        const i = ((y + dy) * 400 + x + dx) * 4;
        return d[i + 3] === 255 && !(d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255);
      }));
      // New lg/lg arms: 4.5 × 2.5 line widths from a vertex 10 / sin θ behind the tip.
      const vertexBack = 10 / Math.sin(Math.atan2(2.5, 4.5));
      const onArm = (x: number, y: number) => [-1, 1].some(side => {
        const ax = -vertexBack, bx = -vertexBack - 90, by = side * 50;
        const px = (x + .5 - tip.x) * u.x + (y + .5 - tip.y) * u.y, py = (x + .5 - tip.x) * n.x + (y + .5 - tip.y) * n.y;
        const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + py * by) / ((bx - ax) ** 2 + by ** 2)));
        return Math.hypot(px - ax - t * (bx - ax), py - t * by) < 8.5 && Math.abs(py) > 11.5;
      });
      let compared = 0, worst = 0, armCompared = 0, armWorst = 0;
      for (let i = 0; i < now.length; i += 4) {
        const x = (i / 4) % 400, y = Math.floor(i / 1600);
        if (Math.hypot(x - tip.x, y - tip.y) >= 185) {
          worst = Math.max(worst, delta(i));
          if (main[i + 3] === 255 && (main[i] !== 255 || main[i + 1] !== 255 || main[i + 2] !== 255)) compared++;
        } else if (x > 0 && y > 0 && x < 399 && y < 399 && onArm(x, y) && solid(now, x, y) && solid(main, x, y)) {
          armWorst = Math.max(armWorst, delta(i));
          armCompared++;
        }
      }
      expect(armCompared, `${route}/${name} arms`).toBeGreaterThan(200);
      expect(armWorst, `${route}/${name} arms`).toBeLessThanOrEqual(2);
      expect(compared, `${route}/${name}`).toBeGreaterThan(1000);
      expect(worst, `${route}/${name}`).toBeLessThanOrEqual(2);
    }
  }, 30000);

  it('preserves ordinary pattern scope through path tracking and effect-canvas inheritance', () => {
    const { Canvas } = skia as NonNullable<typeof skia>;
    const source = new Canvas(100, 100).getContext('2d') as unknown as CanvasRenderingContext2D;
    const paint = (tracked: boolean) => {
      const target = new Canvas(100, 100).getContext('2d') as unknown as CanvasRenderingContext2D;
      target.translate(30, 20);
      target.rotate(Math.PI / 6);
      withPatternPointScale(source, 2, () => withPatternCoordinateSpace(source,
        { a: 1.2, b: .2, c: -.3, d: .8, e: 4, f: 7 }, () => {
          withInheritedPatternScope(tracked ? trackPaintPath(source) : source, target, () => {
            target.fillStyle = resolveFill(fills.pattern, target, 0, 0, 50, 50) as CanvasPattern;
            target.fillRect(0, 0, 50, 50);
          }, { x: 3, y: 5 });
        }));
      return target.getImageData(0, 0, 100, 100).data;
    };
    expect(paint(true)).toEqual(paint(false));
  });
});
