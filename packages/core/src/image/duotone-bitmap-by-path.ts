import { preferVectorBlip } from './blip-gate.js';
import { acquireCurrentBitmapCacheLease } from './bitmap-image-by-path.js';
import { MAX_IMAGE_EFFECT_PIXEL_WORK, OoxmlDecodedImageLimitError } from './pixel-budget.js';
// Ordered DrawingML blip effects for hosts that retain complete CT_Blip
// chains. XLSX's duotone-only adapter imports the algorithm-free owner directly.
import { getCachedPixelTransformBitmapByPath } from './pixel-transform-bitmap-by-path.js';
import { getCachedDuotoneOnlyBitmapByPath, duotoneOnlyCacheKey } from './duotone-only-bitmap-by-path.js';
import { applyImageDataTransform, type Duotone } from './duotone.js';
import { applyBlipPixelEffects, assertBlipPixelEffectsBudget, blipPixelEffectsKey,
  isBlipPixelEffects, blipEffectImageFills, blipPixelEffectWork, type BlipPixelEffects } from './blip-effects.js';
import { OoxmlError } from '../errors/ooxml-error.js';
export { dropDuotoneBitmapCache } from './pixel-transform-bitmap-by-path.js';

export function duotoneCacheKey(path: string, value?: Duotone | BlipPixelEffects | null): string {
  return isBlipPixelEffects(value) ? `${path}|fx:${blipPixelEffectsKey(value)}` : duotoneOnlyCacheKey(path, value);
}
export async function getCachedDuotoneBitmapByPath(
  imagePath: string, mimeType: string, value: Duotone | BlipPixelEffects | null | undefined,
  fetchImage: Parameters<typeof getCachedPixelTransformBitmapByPath>[3],
  opts: Parameters<typeof getCachedPixelTransformBitmapByPath>[4] = {},
): Promise<ImageBitmap | null> {
  if (!isBlipPixelEffects(value)) return getCachedDuotoneOnlyBitmapByPath(imagePath, mimeType, value, fetchImage, opts);
  assertBlipPixelEffectsBudget(value, 0);
  const release = blipEffectImageFills(value.effects).length ? acquireCurrentBitmapCacheLease(fetchImage) : undefined;
  return loadEffects(imagePath, mimeType, value, fetchImage, opts, { work: 0 }).finally(() => release?.());
}
// Validation failures must reject the promise so the outer source lease is released.
async function loadEffects(
  imagePath: string, mimeType: string, value: BlipPixelEffects,
  fetchImage: Parameters<typeof getCachedPixelTransformBitmapByPath>[3],
  opts: NonNullable<Parameters<typeof getCachedPixelTransformBitmapByPath>[4]>,
  ledger: { work: number },
): Promise<ImageBitmap | null> {
  // JSON tuples encode valid finite physical dimensions without decimal
  // ambiguity. Reject invalid numbers before JSON can collapse them to null.
  if (![opts.widthPt ?? 0, opts.heightPt ?? 0].every(v => Number.isFinite(v) && v >= 0)) {
    throw new OoxmlError('unsupported-image-effect', 'Invalid physical image effect dimensions');
  }
  const physical = (width?: number, height?: number): BlipPixelEffects => ({ ...value,
    emuPerPixelX: opts.widthPt && width ? opts.widthPt * 12700 / width : value.emuPerPixelX,
    emuPerPixelY: opts.heightPt && height ? opts.heightPt * 12700 / height : value.emuPerPixelY,
  });
  const images = new Map<object, CanvasImageSource>();
  return getCachedPixelTransformBitmapByPath(imagePath, mimeType, {
    key: `fx:${blipPixelEffectsKey(value)}|physical:${JSON.stringify([opts.widthPt ?? 0, opts.heightPt ?? 0])}`,
    strict: true,
    preflight: (pixels, width, height) => {
      assertBlipPixelEffectsBudget(physical(width, height), pixels, width && height ? { width, height } : undefined);
      if (width && height) {
        ledger.work += blipPixelEffectWork(physical(width, height), width, height);
        if (ledger.work > MAX_IMAGE_EFFECT_PIXEL_WORK) throw new OoxmlDecodedImageLimitError('image-effect-work', MAX_IMAGE_EFFECT_PIXEL_WORK, ledger.work);
      }
    },
    prepare: async base => {
      const effects = physical(base.width, base.height);
      for (const fill of blipEffectImageFills(effects.effects)) {
        const vector = !fill.blipEffects?.length && preferVectorBlip(fill);
        const path = vector ? fill.svgImagePath as string : fill.imagePath;
        const mime = vector ? 'image/svg+xml' : fill.mimeType;
        const image = fill.blipEffects?.length
          ? await loadEffects(path, mime, { effects: fill.blipEffects, duotone: fill.duotone }, fetchImage, opts, ledger)
          : await getCachedDuotoneOnlyBitmapByPath(path, mime, fill.duotone, fetchImage, opts);
        if (!image) throw new OoxmlError('unsupported-image-effect', 'Image fill decode unavailable');
        images.set(fill, image);
      }
      let additionalPixels = 0;
      for (const image of new Set(images.values())) {
        if (image === base) continue;
        const size = image as { width: number; height: number };
        additionalPixels += size.width * size.height;
      }
      assertBlipPixelEffectsBudget(effects, base.width * base.height, base, additionalPixels);
    },
    apply: (base, options) => applyImageDataTransform(base,
      data => applyBlipPixelEffects(data, physical(base.width, base.height), { offscreenFactory: opts.offscreenFactory, images, baseImage: base }), options),
  }, fetchImage, opts);
}
