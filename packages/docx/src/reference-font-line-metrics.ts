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
function preferredProfiles(
  family: string | null | undefined,
  weight: number,
  style: 'normal' | 'italic',
): readonly ReferenceFontMetricProfile[] {
  if (!family?.trim()) return NO_PROFILES;
  const key = `${weight}|${style}|${family}`;
  const retained = preferredProfilesMemo.get(key);
  if (retained !== undefined) return retained;
  const sourceGroups = [
    ['office-mac'], ['macos-system', 'macos-supplemental'], ['published-open-font'],
  ] as const;
  let result = NO_PROFILES;
  for (const sources of sourceGroups) {
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
 * a bounded Word-for-Mac hhea projection: ordinary faces use signed hhea
 * leading; OS/2 code-page bits 17–20 select a centered 1.3× hhea box. This
 * was observed on static synthetic TrueType faces with Latin text, 8–48pt,
 * isolated bits 16–21, changed hhea sides/gap, and equal-ratio UPM controls.
 * It is not established for other Office versions or fallback faces. A
 * controlled Word-for-Mac PDF confirmed the normal-line minimum for Calibri:
 * at 11pt, atLeast 0–269 twips stays at 13.44pt while 360/480 twips yields
 * 18/24pt; at 24pt, 0/480 twips both retain 29.28pt. Those observations do
 * not establish the atLeast projection for other faces or grid cases. The
 * lookup is a reference policy rather than proof of the
 * installed face. It remains separate from resource identity, cmap coverage,
 * shaping, width measurement, and paint routing.
 *
 * Library policy uses Windows Office as the layout reference, independent of
 * the browser or Node host OS. Both vertical and xAvg lookups prefer Office
 * metadata, then macOS system/Supplemental, then published open-font profiles.
 * The catalog's `office-mac` source is a snapshot of Office-for-Mac bundled
 * faces (see scripts/generate-font-reference-metrics.py), not a verified
 * Windows catalog. Preferring it is reference policy, not evidence that every
 * Windows Office release has identical tables. The catalog cannot prove the
 * installed/painted face.
 * The secondary and open-font catalogs are considered only when the tuple is
 * absent from preferred sources. A source group is admitted only when every matching
 * profile projects to identical vertical values; an ambiguous family therefore
 * retains the ordinary measured fallback.
 */
export function referenceFontLineMetrics(
  family: string | null | undefined,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
): ReferenceFontLineMetrics | undefined {
  return identicalProjection(preferredProfiles(family, weight, style));
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
