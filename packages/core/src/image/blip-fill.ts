import type { Fill } from '../types/common.js';
import type { BlipEffectFill } from './blip-effects.js';
import type { EffectBuffer } from './blip-blur.js';
import { resolveFill } from '../shape/paint.js';
import { drawImageCropped, imageNaturalSize } from './crop.js';
import { defaultOffscreenFactory, type OffscreenFactory } from './duotone.js';
import { OoxmlError } from '../errors/ooxml-error.js';
import { MAX_IMAGE_EFFECT_PIXEL_WORK, OoxmlDecodedImageLimitError } from './pixel-budget.js';

export type BlendMode = 'darken' | 'lighten' | 'mult' | 'over' | 'screen';
export interface BlipEffectRuntime {
  readonly offscreenFactory?: OffscreenFactory;
  readonly images?: ReadonlyMap<object, CanvasImageSource>;
  readonly baseImage?: CanvasImageSource;
}

/** §20.1.8.29 / §20.1.10.11. Separable blend colors, then Porter-Duff
 * source-over in premultiplied form; return straight RGBA. `over` means
 * overlaying the fill (source-over), not Photoshop's unrelated Overlay mode. */
export function blendPixel(base: ArrayLike<number>, fill: ArrayLike<number>, mode: BlendMode): number[] {
  const out = [0, 0, 0, 0];
  blendRgba(base, 0, fill, 0, out, 0, mode); return out;
}
/** One in-place-safe blend, with no pixel-loop allocations. Negative offsets
 * sample transparent pixels outside an effect's finite grid. */
export function blendRgba(base: ArrayLike<number>, bi: number, fill: ArrayLike<number>, fi: number,
  out: { [n: number]: number }, oi: number, mode: BlendMode): void {
  const ab = bi < 0 ? 0 : base[bi + 3] / 255, af = fi < 0 ? 0 : fill[fi + 3] / 255;
  const a = af + ab * (1 - af);
  for (let c = 0; c < 3; c++) {
    const b = bi < 0 ? 0 : base[bi + c] / 255, f = fi < 0 ? 0 : fill[fi + c] / 255;
    const blended = mode === 'darken' ? Math.min(b, f) : mode === 'lighten' ? Math.max(b, f)
      : mode === 'mult' ? b * f : mode === 'screen' ? b + f - b * f : f;
    out[oi + c] = a > 0 ? Math.round(255 * ((1 - af) * ab * b + (1 - ab) * af * f + ab * af * blended) / a) : 0;
  }
  out[oi + 3] = Math.round(a * 255);
}
export function effectFillPixels(
  fill: BlipEffectFill, input: EffectBuffer, emuX: number, emuY: number, runtime: BlipEffectRuntime,
): EffectBuffer {
  if (fill.fillType === 'solid' || fill.fillType === 'none') {
    const data = new Uint8ClampedArray(input.width * input.height * 4);
    if (fill.fillType === 'solid') {
      const h = fill.color.replace(/^#/, '');
      const rgba = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      rgba.push(h.length === 8 ? parseInt(h.slice(6), 16) : 255);
      const frame = input.frame ?? { x: 0, y: 0, width: input.width, height: input.height };
      // A preceding grow changes the effect grid, not the authored fill box.
      // The fast solid path has the same bounds as resolveFill/fillRect below.
      for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
        if (x + .5 < frame.x || x + .5 >= frame.x + frame.width || y + .5 < frame.y || y + .5 >= frame.y + frame.height) continue;
        data.set(rgba, (y * input.width + x) * 4);
      }
    }
    return { data, width: input.width, height: input.height };
  }
  const factory = runtime.offscreenFactory ?? defaultOffscreenFactory;
  const surface = factory(input.width, input.height);
  const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!surface || !ctx) throw new OoxmlError('unsupported-image-effect', 'Image fill surface unavailable');
  const f = input.frame ?? { x: 0, y: 0, width: input.width, height: input.height };
  const sx = 12700 / emuX, sy = 12700 / emuY;
  const w = f.width / sx, h = f.height / sy;
  try {
    ctx.translate(f.x, f.y); ctx.scale(sx, sy);
    if (fill.fillType === 'image') {
      const image = runtime.images?.get(fill);
      if (!image) throw new OoxmlError('unsupported-image-effect', 'Image fill source unavailable');
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      if (fill.alpha != null) ctx.globalAlpha *= fill.alpha;
      if (fill.tile) {
        const tile = fill.tile, natural = imageNaturalSize(image);
        // §20.1.8.58. Missing placement facts use the shared image painter's
        // top-left, unscaled grid. The source's nominal 96 dpi is the existing
        // decoder policy when embedded DPI is unavailable.
        const tw = natural.w * 72 / (fill.dpi || 96) * (tile.sx ?? 1);
        const th = natural.h * 72 / (fill.dpi || 96) * (tile.sy ?? 1);
        const cols = Math.ceil(w / tw) + 2, rows = Math.ceil(h / th) + 2;
        const work = cols * rows;
        if (!Number.isSafeInteger(work) || work > MAX_IMAGE_EFFECT_PIXEL_WORK) {
          throw new OoxmlDecodedImageLimitError('image-effect-work', MAX_IMAGE_EFFECT_PIXEL_WORK,
            Number.isSafeInteger(work) ? work : Number.MAX_SAFE_INTEGER);
        }
        const alignment = tile.algn ?? 'tl';
        const ax = alignment.endsWith('r') || alignment === 'r' ? w - tw
          : ['t', 'ctr', 'b'].includes(alignment) ? (w - tw) / 2 : 0;
        const ay = alignment.startsWith('b') ? h - th
          : ['l', 'ctr', 'r'].includes(alignment) ? (h - th) / 2 : 0;
        const ox = ax + (tile.tx ?? 0) / 12700, oy = ay + (tile.ty ?? 0) / 12700;
        const x0 = Math.floor(-ox / tw), y0 = Math.floor(-oy / th);
        for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x0 + cols; x++) {
          const flipX = (tile.flip === 'x' || tile.flip === 'xy') && Math.abs(x % 2) === 1;
          const flipY = (tile.flip === 'y' || tile.flip === 'xy') && Math.abs(y % 2) === 1;
          ctx.save(); ctx.translate(ox + x * tw, oy + y * th);
          ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          drawImageCropped(ctx, image, fill.srcRect, flipX ? -tw : 0, flipY ? -th : 0, tw, th);
          ctx.restore();
        }
      } else {
        const r = fill.fillRect;
        drawImageCropped(ctx, image, fill.srcRect, (r?.l ?? 0) * w, (r?.t ?? 0) * h,
          w * (1 - (r?.l ?? 0) - (r?.r ?? 0)), h * (1 - (r?.t ?? 0) - (r?.b ?? 0)));
      }
      ctx.restore();
    } else {
      // Gradients (including path shades), patterns and solid colors use the
      // existing shared fill painter, preserving its palette/geometry policy.
      const recipe: Fill = fill.fillType === 'gradient' ? { ...fill, stops: [...fill.stops] } : fill;
      const paint = resolveFill(recipe, ctx, 0, 0, w, h, 0, 1);
      if (!paint) throw new OoxmlError('unsupported-image-effect', 'Malformed or unavailable image-effect fill brush');
      ctx.fillStyle = paint; ctx.fillRect(0, 0, w, h);
    }
    return ctx.getImageData(0, 0, input.width, input.height);
  } finally {
    // Release the raster backing store before the next graph branch.
    (surface as { width: number; height: number }).width = 0;
  }
}
