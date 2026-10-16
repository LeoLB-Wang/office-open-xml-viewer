import {
  findReferenceFontMetrics,
  type ReferenceFontMetricProfile,
} from '@silurus/ooxml-core';
import { wordOpenTypeAutoLineRatios } from './layout/line-compatibility.js';

export interface ReferenceFontLineMetrics {
  readonly lineHeightRatio: number;
  readonly farEastCodePage: boolean;
  readonly designAscentRatio: number;
  readonly designDescentRatio: number;
  readonly eastAsianLineHeightRatio?: undefined;
}

const projectedProfiles = new WeakMap<object, ReferenceFontLineMetrics | null>();

// Layout asks for the same few (family, weight, style) tuples for every text
// segment. The answer is a pure function of the immutable generated catalog,
// so it is memoized; the bound only caps documents that name many families.
const preferredProfilesMemoLimit = 1024;
const preferredProfilesMemo = new Map<string, readonly ReferenceFontMetricProfile[]>();
const NO_PROFILES = Object.freeze([]) as readonly ReferenceFontMetricProfile[];

/** One source-choice authority for both vertical and xAvg projections. A
 * populated but ambiguous preferred group must never fall through to a
 * lower priority source. */
const SOURCE_GROUPS = [
  ['office-mac'], ['macos-system', 'macos-supplemental'], ['published-open-font'],
] as const;

/** CSS Fonts Level 4 §5.2 step 4: the face a browser selects for a requested
 * tuple the family does not contain. Style narrows first (italic → oblique →
 * normal; the catalog has no oblique faces), then weight: above 500 heavier
 * ascending then lighter descending; below 400 lighter descending then heavier
 * ascending; 400–500 heavier up to 500, then lighter descending, then above
 * 500 ascending. When the host has no face for the tuple either, Canvas
 * synthesizes bold/oblique from the matched face, which changes advances and
 * ink but not that face's vertical tables. */
function cssMatchedTuple(
  available: readonly ReferenceFontMetricProfile[],
  weight: number,
  style: 'normal' | 'italic',
): { weight: number; style: 'normal' | 'italic' } | undefined {
  const styles = style === 'italic' ? ['italic', 'normal'] as const : ['normal', 'italic'] as const;
  for (const candidateStyle of styles) {
    const weights = [...new Set(available
      .filter((profile) => profile.style === candidateStyle)
      .map((profile) => profile.weight))];
    if (weights.length === 0) continue;
    if (weights.includes(weight)) return { weight, style: candidateStyle };
    const lighter = weights.filter((w) => w < weight).sort((x, y) => y - x);
    const heavier = weights.filter((w) => w > weight).sort((x, y) => x - y);
    const order = weight > 500 ? [...heavier, ...lighter]
      : weight < 400 ? [...lighter, ...heavier]
      // 400–500: heavier up to 500, then lighter, then above 500.
      : [...heavier.filter((w) => w <= 500), ...lighter, ...heavier.filter((w) => w > 500)];
    return { weight: order[0]!, style: candidateStyle };
  }
  return undefined;
}

function preferredProfiles(
  family: string | null | undefined,
  weight: number,
  style: 'normal' | 'italic',
): readonly ReferenceFontMetricProfile[] {
  if (!family?.trim()) return NO_PROFILES;
  const key = `${weight}|${style}|${family}`;
  const retained = preferredProfilesMemo.get(key);
  if (retained !== undefined) return retained;
  let result = NO_PROFILES;
  for (const sources of SOURCE_GROUPS) {
    const profiles = sources.flatMap((source) =>
      findReferenceFontMetrics(family, { source, weight, style }));
    if (profiles.length > 0) {
      result = Object.freeze(profiles);
      break;
    }
  }
  preferredProfilesMemo.set(key, result);
  if (preferredProfilesMemo.size > preferredProfilesMemoLimit) {
    preferredProfilesMemo.delete(preferredProfilesMemo.keys().next().value as string);
  }
  return result;
}

function project(profile: ReferenceFontMetricProfile): ReferenceFontLineMetrics | null {
  const retained = projectedProfiles.get(profile);
  if (retained !== undefined) return retained;
  // The catalog cannot prove the installed/painted face. Its class is used
  // only as vertical reference geometry, and unknown OS/2 data is declined.
  const projected = profile.farEastCodePage == null ? null : wordOpenTypeAutoLineRatios({
    unitsPerEm: profile.unitsPerEm,
    hheaAscent: profile.hhea[0],
    hheaDescent: profile.hhea[1],
    hheaLineGap: profile.hhea[2],
    winAscent: profile.win?.[0],
    winDescent: profile.win?.[1],
    farEastCodePage: profile.farEastCodePage,
  });
  const result = projected?.lineHeightRatio != null
    && projected.designAscentRatio != null
    && projected.designDescentRatio != null
    ? Object.freeze({
        lineHeightRatio: projected.lineHeightRatio,
        farEastCodePage: profile.farEastCodePage === true,
        designAscentRatio: projected.designAscentRatio,
        designDescentRatio: projected.designDescentRatio,
      })
    : null;
  projectedProfiles.set(profile, result);
  return result;
}

function identicalProjection(
  profiles: readonly ReferenceFontMetricProfile[],
): ReferenceFontLineMetrics | undefined {
  const projected = profiles.map(project);
  const first = projected[0];
  if (!first || projected.some((candidate) => !candidate
    || candidate.farEastCodePage !== first.farEastCodePage
    || candidate.lineHeightRatio !== first.lineHeightRatio
    || candidate.designAscentRatio !== first.designAscentRatio
    || candidate.designDescentRatio !== first.designDescentRatio)) return undefined;
  return first;
}

/**
 * Resolve metadata-only reference vertical geometry for an authored face.
 * ECMA-376 Part 1 §17.3.1.33 defines automatic spacing as a multiple of the
 * normal single line but does not select an OpenType metric table. DOCX applies
 * a Windows-adjudicated projection: ordinary faces use signed hhea leading;
 * OS/2 code-page bits 17–20 select a centered 1.3× usWin box. Historical Mac
 * synthetic TrueType controls with Latin text, 8–48pt, isolated bits 16–21
 * and varied hhea/UPM established the class but used hhea. Windows 16.0.20430
 * grid and atLeast controls distinguish the boxes for Yu Gothic/Mincho, with equal-box
 * MS Mincho/MS Gothic/Meiryo counterexamples. Both platforms' tested faces
 * have identical vertical tables; policy chooses Windows without an OS branch.
 * Missing usWin declines FE projection rather than substituting hhea. A
 * controlled Word-for-Mac PDF confirmed the normal-line minimum for Calibri:
 * at 11pt, atLeast 0–269 twips stays at 13.44pt while 360/480 twips yields
 * 18/24pt; at 24pt, 0/480 twips both retain 29.28pt. Those observations do
 * not establish the atLeast projection for other faces or grid cases. The
 * lookup is fallback metadata rather than proof of the installed face.
 * Prepared host resources take precedence (host-font-line-metrics.ts).
 * Resource identity, cmap coverage, shaping, widths and paint routing remain
 * independent admission checks.
 *
 * For identical font data, apply the projection documented beside
 * wordOpenTypeAutoLineRatios, independently of the viewer OS. Different
 * installed resources retain their own measured geometry. Only when required host data is unavailable or
 * unmeasurable do vertical lookups use this catalog order: Office, then macOS
 * system/Supplemental, then published open-font profiles. xAvg remains a
 * separate metadata-only lookup with its existing exact-route gate.
 * The catalog's `office-mac` source is a snapshot of Office-for-Mac bundled
 * faces (see scripts/generate-font-reference-metrics.py), not a verified
 * Windows catalog. Preferring it is reference policy, not evidence that every
 * Windows Office release has identical tables. The catalog cannot prove the
 * installed/painted face.
 * The secondary and open-font catalogs are considered only when the tuple is
 * absent from preferred sources. A source group is admitted only when every matching
 * profile projects to identical vertical values; an ambiguous family therefore
 * retains the ordinary measured fallback. A tuple absent from every source
 * (for example bold of a family catalogued only at 400) is exposed only through
 * {@link synthesizedFaceReferenceLineMetrics}, which requires measured proof.
 */
export function referenceFontLineMetrics(
  family: string | null | undefined,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
): ReferenceFontLineMetrics | undefined {
  return identicalProjection(preferredProfiles(family, weight, style));
}

export interface SynthesizedFaceReferenceLineMetrics {
  readonly metric: ReferenceFontLineMetrics;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /** The matched face's em-relative [ascent, descent] boxes: hhea, then usWin
   * when present. A browser font box reports one of these tables. */
  readonly fontBoxes: readonly (readonly [number, number])[];
}

/** Candidate for a tuple absent from every source: the CSS-matched catalogued
 * face of the same family and its projection. Metadata alone cannot tell
 * whether the host synthesizes the requested tuple from that face or has a
 * genuine face missing from the catalog; callers must prove it by measuring
 * the requested tuple's Canvas font box against the matched face's tables. */
export function synthesizedFaceReferenceLineMetrics(
  family: string | null | undefined,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
): SynthesizedFaceReferenceLineMetrics | undefined {
  if (!family?.trim() || preferredProfiles(family, weight, style).length > 0) return undefined;
  for (const sources of SOURCE_GROUPS) {
    const available = sources.flatMap((source) => findReferenceFontMetrics(family, { source }));
    const tuple = available.length > 0 ? cssMatchedTuple(available, weight, style) : undefined;
    if (!tuple) continue;
    const profiles = preferredProfiles(family, tuple.weight, tuple.style);
    const metric = identicalProjection(profiles);
    const boxes = profiles.map((profile): (readonly [number, number])[] => [
      [profile.hhea[0] / profile.unitsPerEm, -profile.hhea[1] / profile.unitsPerEm],
      ...(profile.win
        ? [[profile.win[0] / profile.unitsPerEm, profile.win[1] / profile.unitsPerEm] as const]
        : []),
    ]);
    const first = JSON.stringify(boxes[0]);
    return metric && boxes.every((box) => JSON.stringify(box) === first)
      ? { metric, ...tuple, fontBoxes: boxes[0]! }
      : undefined;
  }
  return undefined;
}

/** Metadata-only OS/2 average width for a native face selected by Canvas.
 * The caller must apply the same native-route gate as vertical references;
 * the catalog cannot establish that a named fallback painted the text. */
export function referenceFontAverageWidthRatio(
  family: string | null | undefined,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
): number | undefined {
  const ratios = preferredProfiles(family, weight, style).map((profile) =>
    profile.xAvgCharWidth != null && profile.xAvgCharWidth > 0
      ? profile.xAvgCharWidth / profile.unitsPerEm
      : undefined);
  return ratios[0] != null && ratios.every((ratio) => ratio === ratios[0])
    ? ratios[0]
    : undefined;
}
