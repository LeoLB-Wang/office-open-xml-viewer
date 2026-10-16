import { expect, it, vi } from 'vitest';
import { paintChartImageFill, withChartImageLookup } from './image-fill.js';
import { OoxmlDecodedImageLimitError } from '../image/pixel-budget.js';
import { EMU_PER_PT, PT_TO_PX } from '../units.js';
import type { ImageFill } from '../types/common.js';

it('paints a huge finite tile translation at its remainder phase', () => {
  const translations = (tx: number) => {
    const recorded: number[][] = [];
    const ctx = new Proxy({}, {
      get: (_target, key) => key === 'translate'
        ? (x: number, y: number) => { recorded.push([x, y]); }
        : () => {},
    }) as unknown as CanvasRenderingContext2D;
    const fill: ImageFill = {
      fillType: 'image', imagePath: 'tile.png', mimeType: 'image/png', dpi: 72,
      tile: { algn: 'tl', sx: 1, sy: 1, tx, ty: 0, flip: 'x' },
    };
    const painted = withChartImageLookup(() => ({ width: 10, height: 10 }) as CanvasImageSource,
      () => paintChartImageFill(ctx, fill, 0, 0, 40, 40));
    expect(painted).toBe(true);
    return recorded;
  };
  // 10pt tiles mirrored on x repeat every 20pt. 2^30 whole periods plus 5pt
  // must keep the 5pt phase and flip parity rather than stall or be rejected.
  const huge = translations((2 ** 30 * 20 + 5) * EMU_PER_PT);
  const near = translations(5 * EMU_PER_PT);
  expect(huge).toHaveLength(near.length);
  huge.forEach(([x, y], index) => {
    expect(x).toBeCloseTo(near[index]![0]!, 3);
    expect(y).toBeCloseTo(near[index]![1]!, 3);
  });
});

it('rejects the extreme shifted tile grid instead of stalling', () => {
  // Before phase normalization x0 + step === x0 and this loop never advanced.
  // Its tiles are far narrower than the offset's rounding, so the phase is not
  // representable and the fill fails closed before any draw.
  const drawImage = vi.fn();
  const ctx = new Proxy({ drawImage }, {
    get: (target, key) => key === 'drawImage' ? target.drawImage : () => {},
  }) as unknown as CanvasRenderingContext2D;
  const fill: ImageFill = {
    fillType: 'image', imagePath: 'tile.png', mimeType: 'image/png', dpi: 65535,
    tile: { algn: 'tl', sx: 0.0001, sy: 10000, tx: 27273042316900, ty: 0 },
  };
  const emu = PT_TO_PX / EMU_PER_PT;
  expect(() => withChartImageLookup(() => ({ width: 1, height: 1 }) as CanvasImageSource,
    () => paintChartImageFill(ctx, fill, 0, 0, emu, emu))).toThrow(OoxmlDecodedImageLimitError);
  expect(drawImage).not.toHaveBeenCalled();
});

it('fails closed when conversion rounding would misregister a huge mirrored tile phase', () => {
  const draws = vi.fn();
  const ctx = new Proxy({ drawImage: draws }, {
    get: (target, key) => key === 'drawImage' ? target.drawImage : () => {},
  }) as unknown as CanvasRenderingContext2D;
  const fill = (tx: number): ImageFill => ({
    fillType: 'image', imagePath: 'tile.png', mimeType: 'image/png', dpi: 65535,
    tile: { algn: 'tl', sx: 0.0001, sy: 10000, tx, ty: 0, flip: 'x' },
  });
  const zoomedPtToPx = (4 / 3) * 1e7;
  const render = (tx: number) => withChartImageLookup(() => ({ width: 2, height: 1 }) as CanvasImageSource,
    () => paintChartImageFill(ctx, fill(tx), 0, 0, 1000, 1000, zoomedPtToPx));
  // These offsets differ by whole mirrored periods, but the converted pixel
  // offset of the first has lost more precision than one tile is wide.
  expect(render(508)).toBe(true);
  expect(() => render(27273042316900)).toThrow(OoxmlDecodedImageLimitError);
});
