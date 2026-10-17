import { ownValue } from '@silurus/ooxml-core/internal/own-key';
/**
 * Normalize a WordprocessingML underline style (ECMA-376 §17.18.99
 * ST_Underline, the `<w:u w:val>` vocabulary) to the DrawingML underline style
 * (§20.1.10.82 ST_TextUnderlineType) that `core.drawUnderline` dispatches on.
 *
 * The two enums cover the same visual repertoire but differ in spelling
 * (`wave` vs `wavy`, `dashed*` vs `dash*`), element order (`dashDot*` vs
 * `dotDash*`), and a few names DrawingML lacks (`thick`, `words`). Each such
 * case is annotated below with the §-reference and, where the mapping is an
 * approximation rather than an exact match, why.
 *
 * Anything unknown / absent falls back to the plain single rule (`sng`).
 */
const DOCX_TO_DRAWINGML: Readonly<Record<string, string>> = {
  // ── Exact matches (same name, same rule) ──────────────────────────────────
  double: 'dbl', // §17.18.99 double → §20.1.10.82 dbl
  dotted: 'dotted',
  dottedHeavy: 'dottedHeavy',
  dash: 'dash',
  dashLong: 'dashLong',
  dashLongHeavy: 'dashLongHeavy',
  dotDash: 'dotDash',
  dotDotDash: 'dotDotDash',
  wavyHeavy: 'wavyHeavy',

  // ── Spelling / order normalizations (same rule, different token) ──────────
  single: 'sng', // WML `single` == DrawingML `sng`
  wave: 'wavy', // WML `wave` == DrawingML `wavy`
  wavyDouble: 'wavyDbl', // WML `wavyDouble` == DrawingML `wavyDbl`
  dashedHeavy: 'dashHeavy', // WML spells it `dashed`; DrawingML `dash`
  // WML orders the dot/dash tokens as `dashDot*`; DrawingML as `dotDash*`. Both
  // denote the identical dot-dash rule, so we map to the DrawingML order.
  dashDotHeavy: 'dotDashHeavy',
  dashDotDotHeavy: 'dotDotDashHeavy',

  // ── Approximations (no exact DrawingML primitive) ─────────────────────────
  // §17.18.99 `thick` is a heavier single rule. DrawingML has no `thick`; its
  // `heavy` weight class is the closest (drawUnderline thickens *Heavy ~1.8×),
  // so a thick underline renders as the heavy solid rule.
  thick: 'heavy',
  // §17.18.99 `words` underlines only the word runs (gaps left under spaces).
  // DrawingML has no words-only rule; we approximate it as a continuous single
  // rule. Full word-gap rendering (split the underline at inter-word spaces)
  // would need the segment's space geometry — deferred as a follow-up; single
  // is the closest primitive and the common visual (most `words` text has no
  // multi-space gaps).
  words: 'sng',
};

/**
 * @param val the raw `<w:u w:val>` value (ST_Underline §17.18.99), or undefined.
 * @returns the DrawingML ST_TextUnderlineType (§20.1.10.82) style for
 *   `core.drawUnderline`. `sng` for undefined / `none` / unrecognized input.
 */
export function docxUnderlineToDrawingML(val: string | undefined): string {
  if (!val) return 'sng';
  return ownValue(DOCX_TO_DRAWINGML, val) ?? 'sng';
}
