import { findReferenceFontMetrics } from '../fonts/reference-font-metrics.js';

/**
 * Face and character data for stacked vertical text, `a:bodyPr@vert`
 * `wordArtVert` / `wordArtVertRtl` (ECMA-376 §20.1.10.83 ST_TextVerticalType:
 * "one letter on top of another"). The standard defines no cell metrics.
 * Library policy: use 7/6 × the font-table face box × size for every face:
 * usWinAscent + usWinDescent, or sTypoAscender − sTypoDescender +
 * max(0, sTypoLineGap) under USE_TYPO_METRICS (OpenType OS/2.fsSelection bit 7).
 * Library policy ignores negative line gaps rather than shrinking the face box.
 *
 * Evidence boundary: issue #1626 Mac PowerPoint 16.x PDF controls (12–48 pt,
 * regular/bold) supported this factor for 58 of 63 measured faces. Yu Gothic,
 * SimSun/NSimSun, MingLiU variants (including ExtB), Gulim/Dotum and STZhongsong
 * had larger measured cells. Tests of usWin, hhea with/without lineGap, typo, head bbox
 * and OS/2 version found no common metric explanation; Yu Mincho versus Yu
 * Gothic and SimHei/KaiTi/FangSong versus SimSun provided equal-box
 * counterexamples. Those Mac residuals are accepted differences, not font-name
 * corrections or evidence of Windows Office behaviour. Windows Office remains
 * the fidelity reference where platforms differ; this policy makes no claim
 * of exact Office cell pitch for the exceptional faces.
 */

/** 7/6: the ratio of a stacked cell to the face box. */
export const STACKED_CELL_FACTOR = 7 / 6;

/** Library policy: select the requested weight/style, then relax style before
 * weight so synthetic italic retains the requested weight's metrics and coverage.
 * Finally allow any weight for named cuts (e.g. Medium/Light aliases). Keep the
 * same source preference for the face box and vert coverage at every step. */
function stackedProfile(family: string, bold: boolean, italic: boolean) {
  const weight = bold ? 700 : 400;
  let profiles = findReferenceFontMetrics(family, { weight, style: italic ? 'italic' : 'normal' });
  if (profiles.length === 0) profiles = findReferenceFontMetrics(family, { weight });
  if (profiles.length === 0) profiles = findReferenceFontMetrics(family);
  return profiles.find((p) => p.source === 'macos-supplemental')
    ?? profiles.find((p) => p.source === 'office-mac') ?? profiles[0];
}

/**
 * The font-table face box (em) of `family`: usWin, or typo under
 * USE_TYPO_METRICS. A named weight such as "Yu Mincho Light" is catalogued
 * under its own weight, so a lookup at the run's weight that finds nothing
 * falls back to any weight of the family. Undefined for an unknown face.
 */
export function stackedFaceBox(
  family: string,
  bold: boolean,
  italic: boolean,
): { ascent: number; descent: number } | undefined {
  const profile = stackedProfile(family, bold, italic);
  if (!profile || !(profile.unitsPerEm > 0)) return undefined;
  if (profile.typoMetrics) {
    const [ascender, descender, lineGap] = profile.typoMetrics;
    return { ascent: (ascender + Math.max(0, lineGap)) / profile.unitsPerEm, descent: -descender / profile.unitsPerEm };
  }
  if (!profile.win) return undefined;
  return { ascent: profile.win[0] / profile.unitsPerEm, descent: profile.win[1] / profile.unitsPerEm };
}

/**
 * Characters PowerPoint turns sideways in stacked text. It is not UAX #50: of
 * about 150 characters measured (ASCII and Latin-1 punctuation, general
 * punctuation, arrows, CJK punctuation, brackets, fullwidth forms, small kana),
 * exactly these are handled differently; every other character stands upright
 * in its cell, including ，．：；？！, small kana, 〜, – — and « ».
 * Characters outside the measured set are treated as upright.
 */
export const STACKED_SIDEWAYS: ReadonlySet<number> = new Set(
  [...'()<>[]{}…‥‐←→↑↓―∥、。ー～＝＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗'].map((c) => c.codePointAt(0)!),
);

export function stackedSidewaysCharacter(cp: number): boolean {
  return STACKED_SIDEWAYS.has(cp);
}

/**
 * Whether the requested face covers a sideways character with a GSUB `vert`
 * single substitution (all scripts/languages). Library policy uses `vert` only,
 * excluding `vrt2`: Yu Gothic's U+2225 therefore rotates (#1827). Covered glyphs
 * stand upright in a 1 em cell; uncovered/unknown faces rotate by their horizontal
 * advance. Coverage comes from reference metadata, not the host's selected font.
 */
export function stackedVerticalGlyph(family: string, cp: number, bold = false, italic = false): boolean {
  if (!STACKED_SIDEWAYS.has(cp)) return false;
  return stackedProfile(family, bold, italic)?.stackedVerticalGlyphs?.includes(String.fromCodePoint(cp)) ?? false;
}
