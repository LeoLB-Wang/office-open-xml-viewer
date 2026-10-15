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

function normalizeFamily(family: string): string {
  return family.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

/**
 * Canonical (reference-catalog) family for `family`, lower-cased, so a
 * localized or PostScript alias (游ゴシック, MS-Gothic, 宋体) finds the same
 * table entry as the English name.
 */
function canonicalFamily(family: string): string {
  const profiles = findReferenceFontMetrics(family);
  return normalizeFamily(profiles.length > 0 ? profiles[0].family : family);
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
  let profiles = findReferenceFontMetrics(family, { weight: bold ? 700 : 400, style: italic ? 'italic' : 'normal' });
  if (profiles.length === 0) profiles = findReferenceFontMetrics(family);
  const profile = profiles.find((p) => p.source === 'macos-supplemental')
    ?? profiles.find((p) => p.source === 'office-mac') ?? profiles[0];
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
const STACKED_SIDEWAYS = new Set(
  [...'()<>[]{}…‥‐←→↑↓―∥、。ー～＝＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗'].map((c) => c.codePointAt(0)!),
);

export function stackedSidewaysCharacter(cp: number): boolean {
  return STACKED_SIDEWAYS.has(cp);
}

/**
 * Which sideways characters a face draws with its own vertical glyph. Such a
 * glyph stands upright in a 1 em cell; a face without one draws the character
 * rotated 90° clockwise. Controls: Yu Gothic, MS Gothic, Meiryo and SimSun
 * draw their vertical glyphs; Arial and Cambria Math rotate. The sets are the
 * members of each Office-bundled face's GSUB `vert` coverage. Yu Gothic also
 * draws ∥ with a vertical glyph (wordartvert-supp slide 7), which its `vert`
 * lookup does not list; the other faces follow their `vert` coverage only.
 * A face not in this table (every Latin face) has no vertical glyphs.
 */
const JP_FULL = '…‥‐←→↑↓―∥、。ー～＝＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗';
const MEIRYO_YU = '…‥‐←→↑↓―、。ー～＝＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗';
const SC_SONG = '…‥←→↑↓―∥、。ー～＝＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗';
const SC_HEI = '…←→↑↓、。～＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗';
const DENGXIAN = '←→↑↓∥、。ー～＝＿￣｜（）〔〕［］｛｝〈〉《》「」『』【】〖〗';
const YAHEI = '…‥←→↑↓―∥、。ー～＝＿（）〔〕［］｛｝〈〉《》「」『』【】〖〗';
const KOREAN = '…‥、。（）〔〕［］｛｝〈〉《》「」『』【】';
const MINGLIU = '…‥（）〔〕［］｛｝〈〉《》「」『』【】';
const VERTICAL_GLYPHS: ReadonlyMap<string, ReadonlySet<number>> = new Map(
  ([
    [['ms gothic', 'ms pgothic', 'ms ui gothic', 'ms mincho', 'ms pmincho', 'hggothice', 'hgpgothice', 'hgsgothice',
      'hgminchoe', 'hgpminchoe', 'hgsminchoe', 'hgmarugothicmpro', 'hgsoeikakugothicub', 'hgpsoeikakugothicub',
      'hgssoeikakugothicub'], JP_FULL],
    [['yu gothic'], MEIRYO_YU + '∥'],
    [['meiryo', 'meiryo ui', 'yu gothic ui', 'yu mincho', 'yu mincho demibold'], MEIRYO_YU],
    [['yu gothic medium'], '…‥‐←→↑↓―、。ー～＝＿￣｜（）〔〕［］｛｝《》「」『』【】〖〗'],
    [['simsun', 'nsimsun', 'stzhongsong'], SC_SONG],
    [['simhei', 'kaiti', 'fangsong', 'sthupo', 'stliti', 'stxingkai', 'stxinwei'], SC_HEI],
    [['dengxian'], DENGXIAN],
    [['microsoft yahei', 'microsoft yahei ui'], YAHEI],
    [['microsoft jhenghei'], '…‥、。ー（）〔〕［］｛｝〈〉《》「」『』【】〖〗'],
    [['batang', 'batangche', 'gungsuh', 'gungsuhche', 'gulim', 'gulimche', 'dotum', 'dotumche', 'malgun gothic'], KOREAN],
    [['mingliu', 'pmingliu'], MINGLIU],
    [['mingliu_hkscs'], '…‥（）〔〕｛｝〈〉《》「」『』【】'],
  ] as const).flatMap(([families, chars]) => {
    const set = new Set([...chars].map((c) => c.codePointAt(0)!));
    return families.map((f) => [f, set] as const);
  }),
);

/** Whether `family` draws the sideways character `cp` with a vertical glyph. */
export function stackedVerticalGlyph(family: string, cp: number): boolean {
  const set = VERTICAL_GLYPHS.get(canonicalFamily(family)) ?? VERTICAL_GLYPHS.get(normalizeFamily(family));
  return set?.has(cp) ?? false;
}
