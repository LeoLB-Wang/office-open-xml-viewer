import { expect, it, vi } from 'vitest';
import { paintChartImageFill, withChartImageLookup } from './image-fill';
import type { ImageFill } from '../types/common';

it('raises a typed resource error for the reviewer’s valid-coordinate unrepresentable tile index', () => {
  const drawImage = vi.fn(() => { throw new Error('unsafe grid reached paint'); });
  const ctx = new Proxy({ drawImage }, { get: (target, key) => key === 'drawImage' ? target.drawImage : () => {} }) as unknown as CanvasRenderingContext2D;
  const fill: ImageFill = { fillType: 'image', imagePath: 'tile.png', mimeType: 'image/png', dpi: 65535,
    tile: { algn: 'tl', sx: .0001, sy: 10000, tx: 27273042316900, ty: 0 } };
  expect(() => withChartImageLookup(() => ({ width: 1, height: 1 }) as CanvasImageSource,
    () => paintChartImageFill(ctx, fill, 0, 0, 1 / 9525, 1 / 9525))).toThrowError(expect.objectContaining({ code: 'ooxml-decoded-image-limit' }));
  expect(drawImage).not.toHaveBeenCalled();
});
