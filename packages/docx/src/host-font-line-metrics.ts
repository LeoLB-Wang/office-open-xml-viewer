import {
  activeFontSet,
  findReferenceFontMetrics,
  loadOfficeFontFallbacks,
  measureLocalFontNormalLine,
  type LocalFontNormalLine,
  type OfficeFontFallbackRoute,
  type ResolvedFontMetric,
} from '@silurus/ooxml-core';

/** Resource-aware vertical admission, independent of viewer OS and family
 * spelling. ECMA-376 §17.3.1.33 defines spacing in normal lines, not a catalog
 * version of an installed face. For ordinary local faces retain the host's
 * measured normal box, including signed leading above the baseline (the same
 * partition as wordOpenTypeAutoLineRatios). Catalog profiles are fallback data.
 *
 * CSS normal-line measurement cannot expose OS/2 class/usWin/typo tables.
 * Classification remains catalog fallback metadata, not proof of host OS/2
 * bytes; unknown or disagreeing classes decline this projection.
 * Known Far East tuples therefore decline this measurement and keep the
 * catalog usWin fallback from #1832; parsed resource metrics, including a
 * different host usWin box, always win. This is a measurement capability gate,
 * not a platform selector or a claim that Canvas's box is usWin. Substitutes
 * use their own measured normal box and never the authored face's catalog. */
export function hostFontLineMetric(
  route: OfficeFontFallbackRoute,
  measured: LocalFontNormalLine | null,
): ResolvedFontMetric {
  if (route.metric.lineHeightRatio != null || !measured) return route.metric;
  const profiles = findReferenceFontMetrics(route.requestedFamily, {
    weight: route.weight, style: route.style,
  });
  if (route.source !== 'substitute'
    && profiles.some((profile) => profile.farEastCodePage !== false)) return route.metric;
  const ascent = measured.ascentRatio + measured.lineGapRatio;
  const descent = measured.descentRatio;
  if (!(Number.isFinite(ascent) && Number.isFinite(descent)
    && ascent >= 0 && descent >= 0 && ascent + descent > 0)) return route.metric;
  return Object.freeze({
    ...route.metric,
    lineHeightRatio: ascent + descent,
    designAscentRatio: ascent,
    designDescentRatio: descent,
    lineGapRatio: measured.lineGapRatio,
    ...(profiles.length > 0 && route.source === 'local' ? { farEastCodePage: false } : {}),
  });
}

/** Reuse the positively loaded local() paint registrations. Measurements are
 * cached by their retained FontFace, with no per-segment probes, additional
 * loads, network access or font discovery. DOM-free realms cannot measure the
 * normal-line gap and explicitly keep catalog fallback. */
export async function loadDocxOfficeFontFallbacks(
  ...args: Parameters<typeof loadOfficeFontFallbacks>
): ReturnType<typeof loadOfficeFontFallbacks> {
  const loaded = await loadOfficeFontFallbacks(...args);
  const owner = typeof document === 'undefined' ? null : document;
  const fontSet = args[1] === undefined ? activeFontSet() : args[1];
  if (!owner?.body || !fontSet || owner.fonts !== fontSet) return loaded;
  const context = owner.createElement('canvas').getContext('2d');
  if (!context) return loaded;
  const routes = Object.fromEntries(Object.entries(loaded.routes).map(([key, route]) => {
    const profiles = findReferenceFontMetrics(route.requestedFamily, {
      weight: route.weight, style: route.style,
    });
    const face = loaded.faces.find((candidate) => candidate.family === route.family);
    // A catalog UPM sets only the probe resolution, never the measured answer.
    // Without a design UPM or an exact registration, decline the optional probe.
    const em = profiles[0]?.unitsPerEm;
    const measured = face && em && route.metric.lineHeightRatio == null
      && (route.source === 'substitute'
        || profiles.every((profile) => profile.farEastCodePage === false))
      ? measureLocalFontNormalLine(face, fontSet, context, em, owner) : null;
    return [key, { ...route, metric: hostFontLineMetric(route, measured) }];
  }));
  return { ...loaded, routes };
}
