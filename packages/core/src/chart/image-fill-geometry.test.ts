import { expect, it, vi } from 'vitest';
import { paintChartImageFill, withChartImageLookup } from './image-fill';
import type { ImageFill } from '../types/common';

it('declines an unrepresentable chart tile index before painting', () => {
  const drawImage = vi.fn(() => { throw new Error('unsafe grid reached paint'); });
  const ctx = new Proxy({ drawImage }, { get: (target, key) => key === 'drawImage' ? target.drawImage : () => {} }) as unknown as CanvasRenderingContext2D;
  const fill: ImageFill = { fillType: 'image', imagePath: 'tile.png', mimeType: 'image/png', dpi: 96,
    tile: { algn: 'tl', sx: 1, sy: 1, tx: 1e20, ty: 0 } };
  expect(withChartImageLookup(() => ({ width: 1, height: 1 }) as CanvasImageSource,
    () => paintChartImageFill(fill, ctx, 0, 0, 1, 1))).toBe(false);
  expect(drawImage).not.toHaveBeenCalled();
});
