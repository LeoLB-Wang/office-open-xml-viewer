import { quoteCssFontFamily } from '../internal/css-font-family.js';
import type { CanvasFontBoxProbeContext } from './canvas-font-box.js';

export interface LocalFontNormalLine {
  readonly ascentRatio: number;
  readonly descentRatio: number;
  readonly lineGapRatio: number;
}

// The FontFace is the retained resource, not an authored family or an alias
// shared across FontFaceSets. The weak cache retains no DOM or context.
const measuredLines = new WeakMap<FontFace, { emPx: number; metric: LocalFontNormalLine | null }>();

/** Measure the normal line of an already-loaded exact local() paint resource.
 * Canvas exposes its font box but omits leading. A CSS normal-line strut adds
 * that missing measurement; U+200B creates a line without fallback glyph ink.
 * This is browser geometry, NOT access to OpenType hhea/OS/2 tables. In
 * particular it cannot establish usWin, USE_TYPO_METRICS or code-page bits.
 * Callers must decline projections requiring those unavailable fields.
 *
 * The caller supplies the probe em (a known design UPM avoids CSS-pixel
 * quantization). This runs during resource preparation, never per segment or
 * during paint. A worker/foreign FontFaceSet has no matching DOM strut and
 * returns null, rather than silently measuring a different realm's face. */
export function measureLocalFontNormalLine(
  face: FontFace,
  fontSet: FontFaceSet,
  context: CanvasFontBoxProbeContext,
  emPx: number,
  ownerDocument: Document | null,
): LocalFontNormalLine | null {
  if (face.status !== 'loaded' || !Number.isFinite(emPx) || emPx <= 0
    || !ownerDocument?.body || ownerDocument.fonts !== fontSet) return null;
  const cached = measuredLines.get(face);
  if (cached?.emPx === emPx) return cached.metric;
  const font = `${face.style} ${face.weight} ${emPx}px ${quoteCssFontFamily(face.family)}`;
  const probe = ownerDocument.createElement('span');
  probe.style.cssText = `all:initial;position:fixed;visibility:hidden;white-space:pre;font:${font};line-height:normal;`;
  probe.textContent = '\u200b';
  const previousFont = context.font;
  let result: LocalFontNormalLine | null = null;
  try {
    context.font = font;
    const box = context.measureText('');
    ownerDocument.body.append(probe);
    const height = probe.offsetHeight;
    const ascent = box.fontBoundingBoxAscent;
    const descent = box.fontBoundingBoxDescent;
    if (Number.isFinite(height) && height > 0 && Number.isFinite(ascent)
      && ascent >= 0 && Number.isFinite(descent) && descent >= 0) {
      result = Object.freeze({
        ascentRatio: ascent / emPx,
        descentRatio: descent / emPx,
        lineGapRatio: (height - ascent - descent) / emPx,
      });
    }
  } catch {
    // An unavailable measurement leaves the caller's catalog fallback intact.
  } finally {
    probe.remove();
    context.font = previousFont;
  }
  measuredLines.set(face, { emPx, metric: result });
  return result;
}
