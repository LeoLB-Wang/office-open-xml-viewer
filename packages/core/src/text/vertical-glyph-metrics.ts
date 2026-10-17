// Canvas metrics shared by the DOCX tbRl and PPTX eaVert rotate-layout
// vertical painters. Both draw a vertical column by rotating the page +90° and
// running the horizontal layout; these two metrics place the upright and
// sideways cells on one cross-axis centreline.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Cross-axis (column-thickness) offset, in px, from the alphabetic baseline to
 * the font's EM-BOX CENTRE — i.e. `(fontBoundingBoxAscent − fontBoundingBoxDescent)/2`.
 *
 * This is a FONT metric (glyph-independent): `fontBoundingBox*` describe the
 * font's design box, not one glyph's ink. In vertical text the column's cross
 * axis is where every cell centres, and the UPRIGHT cells (drawn with a `middle`
 * textBaseline) already sit their em box on the caller's `baseline`. A SIDEWAYS
 * (Latin/digit) glyph, however, is drawn on its ALPHABETIC baseline, so its ink
 * (which sits ~this many px above the baseline) would land off the column centre
 * by exactly this amount. Shifting the sideways draw down the cross axis by this
 * offset re-centres its em box on the same line the upright cells use — so mixed
 * columns like "電話 03-1234-5678" share one centreline (ECMA-376 §17.6.20).
 *
 * Falls back to `0.38 × fontPx` (the near-universal CJK/Latin em-box centre ratio)
 * only if the Canvas does not report `fontBoundingBox*` (older engines); on those
 * engines the previous baseline-anchored placement is no worse than today.
 */
export function emBoxCenterAboveBaselinePx(ctx: Ctx2D, sample: string, fontPx: number): number {
  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(sample);
  ctx.textBaseline = prevBaseline;
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  if (typeof asc === 'number' && typeof desc === 'number' && (asc !== 0 || desc !== 0)) {
    return (asc - desc) / 2;
  }
  return 0.38 * fontPx;
}

/**
 * Along-column offset, in px, from a glyph's own cell centre to its INK centre
 * when the glyph is drawn UPRIGHT — i.e. `(actualBoundingBoxAscent −
 * actualBoundingBoxDescent)/2` measured with a `middle` textBaseline.
 *
 * For an upright-drawn glyph the page transform maps the glyph's VERTICAL extent
 * onto the along-column axis, so a glyph whose ink is not vertically centred in
 * its em box (most visibly a substituted vertical bracket form ︵ ︶ ﹁ ﹂,
 * whose ink hugs one end of the cell) lands off the cell centre by this amount.
 * The renderer shifts the draw by `+this` so the ink re-centres — a per-GLYPH
 * measured metric (`actualBoundingBox*` is the tight ink box), NOT a constant.
 * For an ordinary ideograph/kana this is ≈0, so upright CJK cells are unaffected.
 *
 * Returns 0 when the Canvas does not report `actualBoundingBox*` (older engines):
 * the glyph then draws at the cell centre exactly as before this metric existed.
 */
export function inkCenterAboveMiddlePx(ctx: Ctx2D, drawStr: string): number {
  const prevAlign = ctx.textAlign;
  const prevBaseline = ctx.textBaseline;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const m = ctx.measureText(drawStr);
  ctx.textAlign = prevAlign;
  ctx.textBaseline = prevBaseline;
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  if (typeof asc === 'number' && typeof desc === 'number') {
    return (asc - desc) / 2;
  }
  return 0;
}
