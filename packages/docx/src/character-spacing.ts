/** ECMA-376 §17.3.2.35 adds pitch after each rendered character. For run
 * tracking, combining marks (\p{M}) get no w:spacing, even when
 * §17.3.2.26 font-slot selection splits a mark from its base. Unselected U+00AD
 * gets none either (§17.3.3.29); a selected break has its own ordinary '-' glyph.
 * Grid/fit allocation remains per scalar and independent of run tracking.
 * Use this same arithmetic for advances and retained source/cluster geometry.
 * Iterate without materializing or filtering a code-point array per prefix. */
export function textSpacingAdvance(
  text: string,
  characterGridDeltaPx: number,
  charSpacingPx: number,
): number {
  let scalars = 0;
  let pitchBearing = 0;
  for (const character of text) {
    scalars += 1;
    if (character !== '\u00AD' && !COMBINING_MARK.test(character)) pitchBearing += 1;
  }
  return scalars * characterGridDeltaPx + pitchBearing * charSpacingPx;
}

const COMBINING_MARK = /^\p{M}$/u;

