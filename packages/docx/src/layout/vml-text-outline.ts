import type { PathCmd } from '../types.js';
import type { DrawingPaintCommand, LayoutRect } from './types.js';

type TextCommand = Extract<DrawingPaintCommand, {kind: 'watermark-text'}>;

/** Part 4 §19.1.2.23: deform native glyph contours through the already
 * acquired text fitting map, before ordinary point-space stroke acquisition. */
export function acquireVmlTextContours(
  contours: readonly (readonly Readonly<{x: number; y: number}>[])[],
  command: Pick<TextCommand, 'sourceBounds' | 'fitShape' | 'pathSlices'>,
  bounds: LayoutRect,
  maximumWork = Infinity,
): Readonly<{subpaths: PathCmd[][]; workUnits: number}> {
  const {sourceBounds, fitShape} = command;
  const slices = command.pathSlices;
  const point = (p: Readonly<{x: number; y: number}>) => {
    if (slices?.length) {
      const i = Math.max(0, Math.min(slices.length - 1,
        Math.floor((p.x - sourceBounds.xPt) / slices[0]!.sourceWidth)));
      const t = slices[i]!;
      return { x: (t.xPt + t.a * (p.x - t.sourceX) + t.c * p.y) / bounds.widthPt,
        y: (t.yPt + t.b * (p.x - t.sourceX) + t.d * p.y) / bounds.heightPt };
    }
    return { x: (p.x - sourceBounds.xPt) * (fitShape ? 1 / sourceBounds.widthPt : 1 / bounds.widthPt),
      y: (p.y - sourceBounds.yPt) * (fitShape ? 1 / sourceBounds.heightPt : 1 / bounds.heightPt) };
  };
  let contourWork = 0;
  const contourBudget = Math.min(maximumWork ?? Infinity, 1_048_576);
  const subpaths = contours.map(contour => {
    const mapped: ReturnType<typeof point>[] = [];
    const add = (p: Readonly<{x: number; y: number}>) => {
      if (++contourWork > contourBudget) throw new RangeError('VML fitted glyph contour work budget exceeded');
      mapped.push(point(p));
    };
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i]!, q = contour[(i + 1) % contour.length]!;
      add(p);
      // Straight source edges must bend with the baseline too. Split
      // every crossed strip; endpoint-only mapping would cut a chord
      // across a curved E/F/I edge while its fill follows the curve.
      if (slices?.length && p.x !== q.x) {
        const width = slices[0]!.sourceWidth;
        const first = Math.max(1, Math.floor((Math.min(p.x, q.x) - sourceBounds.xPt) / width) + 1);
        const last = Math.min(slices.length - 1, Math.ceil((Math.max(p.x, q.x) - sourceBounds.xPt) / width) - 1);
        // Visit only crossed boundaries. Scanning every strip for every tiny
        // contour edge would amplify acquisition work without adding geometry.
        for (let k = 0; k <= last - first; k++) {
          const t = slices[q.x > p.x ? first + k : last - k]!;
          const x = t.sourceX - t.sourceWidth / 2;
          add({ x, y: p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x) });
        }
      }
    }
    return [...mapped.map((p, i) => ({ cmd: i === 0 ? 'moveTo' as const : 'lineTo' as const, ...p })),
      { cmd: 'close' as const }];
  });
  return {subpaths, workUnits: contourWork};
}
