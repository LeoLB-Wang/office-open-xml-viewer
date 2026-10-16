import { retainFace, releaseFaces } from './font-registry.js';
import { withFontCeiling } from './preload.js';
import type { CanvasFontRoute } from './canvas-route.js';
import type { ResolvedFontMetric } from './resource-metrics.js';
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
  // Engines may clamp a large requested size, so a successful measurement does
  // not prove the requested scale. Accept an em only when the box measured at
  // half that size scales linearly; otherwise halve and retry, and decline
  // (catalog fallback) when no measured scale is linear.
  let result: LocalFontNormalLine | null = null;
  for (let em = emPx, attempt = 0; attempt < LINEAR_PROBE_ATTEMPTS; em /= 2, attempt++) {
    const full = measureNormalBox(face, context, em, ownerDocument);
    const half = full && measureNormalBox(face, context, em / 2, ownerDocument);
    if (!full || !half) break;
    if (scalesLinearly(full, half)) {
      result = Object.freeze({
        ascentRatio: full.ascent / em,
        descentRatio: full.descent / em,
        lineGapRatio: (full.height - full.ascent - full.descent) / em,
      });
      break;
    }
  }
  measuredLines.set(face, { emPx, metric: result });
  return result;
}

/** Halvings tried before declining; bounds probe work per resource. */
const LINEAR_PROBE_ATTEMPTS = 4;

interface NormalBox { readonly height: number; readonly ascent: number; readonly descent: number }

function measureNormalBox(
  face: FontFace, context: CanvasFontBoxProbeContext, emPx: number, ownerDocument: Document,
): NormalBox | null {
  const font = `${face.style} ${face.weight} ${emPx}px ${quoteCssFontFamily(face.family)}`;
  const probe = ownerDocument.createElement('span');
  probe.style.cssText = `all:initial;position:fixed;visibility:hidden;white-space:pre;font:${font};line-height:normal;`;
  probe.textContent = '\u200b';
  const previousFont = context.font;
  try {
    context.font = font;
    const box = context.measureText('');
    ownerDocument.body.append(probe);
    const height = probe.offsetHeight;
    const ascent = box.fontBoundingBoxAscent;
    const descent = box.fontBoundingBoxDescent;
    return Number.isFinite(height) && height > 0 && Number.isFinite(ascent)
      && ascent >= 0 && Number.isFinite(descent) && descent >= 0
      ? { height, ascent, descent } : null;
  } catch {
    // An unavailable measurement leaves the caller's catalog fallback intact.
    return null;
  } finally {
    probe.remove();
    context.font = previousFont;
  }
}

/** offsetHeight is an integer CSS pixel, so each reading carries up to one
 * pixel of rounding; Canvas font boxes carry sub-pixel quantization. */
function scalesLinearly(full: NormalBox, half: NormalBox): boolean {
  return Math.abs(full.height - 2 * half.height) <= 3
    && Math.abs(full.ascent - 2 * half.ascent) <= 1
    && Math.abs(full.descent - 2 * half.descent) <= 1;
}

/** A second registration of the exact source, with only size-adjust changed.
 * CSS Fonts 5 §4.4 (size-adjust) scales outlines and advances, not cmap.
 * Native cmap/shaping/fallback selection is unchanged: owned glyphs
 * have zero ink/advance; fallback glyphs retain their own ink/advance. This is
 * a controlled browser fallback test, not a comparison against a guessed
 * missing-font width or a script/family coverage table. Default ignorables
 * that draw no glyph contribute no geometry in either route.
 * Retain/release this registration with the paint face. */
export async function loadLocalFontCoverageProbe(
  face: FontFace, source: string, fontSet: FontFaceSet,
): Promise<FontFace | null> {
  const family = `${face.family}_coverage`;
  const { face: probe } = retainFace(`local-coverage:${source}:${face.weight}:${face.style}`, fontSet, () => {
    const created = new FontFace(family, source, {
      weight: face.weight, style: face.style, sizeAdjust: '0%',
    } as FontFaceDescriptors & { sizeAdjust: string });
    fontSet.add(created);
    return created;
  });
  try {
    const loaded = await withFontCeiling(probe.load());
    if (loaded && probe.status === 'loaded'
      && (probe as FontFace & { sizeAdjust?: string }).sizeAdjust === '0%'
      && coverageOracleWorks(probe)) return probe;
  } catch { /* Optional coverage unavailable: decline resource geometry. */ }
  releaseFaces([probe]);
  return null;
}

/** A readable size-adjust descriptor does not prove the engine applies it to
 * Canvas geometry. Before trusting zero geometry as ownership, the probe must
 * show both sides of the contract: the face's own Latin glyph measures zero,
 * and at least one glyph from scripts a Latin face rarely carries keeps a
 * positive fallback advance. An engine (or a face) failing either side
 * declines the measured projection and keeps the catalog path. */
const OWNED_PROBE = 'A';
const FALLBACK_PROBE = '漢あ한अ';

function coverageOracleWorks(probe: FontFace): boolean {
  // Once per loaded probe, so a fresh context costs nothing measurable.
  const context = newCoverageContext();
  if (!context) return false;
  try {
    context.font = `${probe.style} ${probe.weight} 100px ${quoteCssFontFamily(probe.family)}`;
    const owned = context.measureText(OWNED_PROBE);
    const fallback = context.measureText(FALLBACK_PROBE);
    return owned.width === 0 && owned.actualBoundingBoxAscent === 0
      && owned.actualBoundingBoxDescent === 0 && fallback.width > 0;
  } catch {
    return false;
  }
}

function newCoverageContext(): CanvasFontBoxProbeContext | null {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1).getContext('2d')
    : typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
}

let coverageContext: CanvasFontBoxProbeContext | null | undefined;
interface CoverageRoute {
  readonly font: string;
  readonly results: Map<string, boolean>;
}
const coverageResults = new WeakMap<ResolvedFontMetric, WeakMap<CanvasFontRoute, CoverageRoute>>();

/** Ask the same native shaper that paints the registered local source. No
 * per-span DOM reads or font loads; bounded weak caches die with the metric.
 * Any fallback ink/advance revokes the primary resource's vertical projection,
 * allowing the existing per-segment Canvas measurement to size that span. */
export function localFontMetricCoversText(
  metric: ResolvedFontMetric, text: string, route: CanvasFontRoute | undefined,
): boolean {
  const family = metric.glyphCoverageProbeFamily;
  if (!family || !text) return !metric.requiresGlyphCoverage || text.length === 0;
  if (!route) return false;
  let byRoute = coverageResults.get(metric);
  if (!byRoute) { byRoute = new WeakMap(); coverageResults.set(metric, byRoute); }
  let prepared = byRoute.get(route);
  if (!prepared) {
    const primary = quoteCssFontFamily(metric.family);
    if (route.familyList !== primary && !route.familyList.startsWith(`${primary},`)) return false;
    // Preserve the complete paint cascade. A caller-owned tail face may cover
    // glyphs that generic/system fallback cannot, including private-use scalars.
    const familyList = quoteCssFontFamily(family) + route.familyList.slice(primary.length);
    prepared = {
      font: `${metric.style ?? 'normal'} ${metric.weight ?? 400} 100px ${familyList}`,
      results: new Map(),
    };
    byRoute.set(route, prepared);
  }
  const cache = prepared.results;
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  coverageContext ??= newCoverageContext();
  if (!coverageContext) return false;
  const previous = coverageContext.font;
  let covered = false;
  try {
    coverageContext.font = prepared.font;
    const result = coverageContext.measureText(text);
    covered = result.width === 0 && result.actualBoundingBoxAscent === 0
      && result.actualBoundingBoxDescent === 0;
  } finally { coverageContext.font = previous; }
  // Resource-governance bound, unrelated to layout or coverage decisions.
  if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
  cache.set(text, covered);
  return covered;
}

/** Measure a worker-resolved exact local source in the DOM realm. The caller
 * must match the returned numbers to that source and tuple; aliases alone are
 * insufficient. The transient probe is refcounted and always released. */
export async function measureLocalFontSourceNormalLine(
  source: string, family: string, weight: number, style: 'normal' | 'italic',
  emPx: number, owner: Document,
): Promise<LocalFontNormalLine | null> {
  const { face } = retainFace(`local-normal:${source}:${weight}:${style}`, owner.fonts, () => {
    const created = new FontFace(`${family}_normal`, source, { weight: String(weight), style });
    owner.fonts.add(created);
    return created;
  });
  try {
    const loaded = await withFontCeiling(face.load());
    const context = owner.createElement('canvas').getContext('2d');
    return loaded && context ? measureLocalFontNormalLine(face, owner.fonts, context, emPx, owner) : null;
  } catch { return null; }
  finally { releaseFaces([face]); }
}
