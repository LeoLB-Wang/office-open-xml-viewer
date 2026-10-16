import {
  normalizeLocalFontMetricFamily,
  type OfficeFontFallbackRequest,
  type OfficeFontFallbackRoute,
} from '@silurus/ooxml-core';

type LoadedOfficeFontFallbacks = {
  faces: FontFace[];
  routes: Record<string, OfficeFontFallbackRoute>;
};

export type OfficeRouteCache = Map<string, Promise<LoadedOfficeFontFallbacks>>;

function requestKey(request: OfficeFontFallbackRequest): string {
  return `${normalizeLocalFontMetricFamily(request.family)}:${request.weight ?? 400}:${request.style ?? 'normal'}`;
}

/**
 * Exact local() routes for the requested authored tuples, shared across slides.
 * Each tuple is acquired once per cache (family, weight and style all key it).
 * Tuples not yet cached are loaded together in one loader call, so a slide keeps
 * the loader's per-call source, concurrency and deadline bounds instead of one
 * unbounded call per tuple.
 */
export async function acquireOfficeRoutes(
  cache: OfficeRouteCache,
  requests: readonly OfficeFontFallbackRequest[],
  load: (requests: OfficeFontFallbackRequest[]) => Promise<LoadedOfficeFontFallbacks>,
): Promise<Record<string, OfficeFontFallbackRoute>> {
  const fresh = new Map<string, OfficeFontFallbackRequest>();
  for (const request of requests) {
    const key = requestKey(request);
    if (!cache.has(key) && !fresh.has(key)) fresh.set(key, request);
  }
  if (fresh.size > 0) {
    const batch = load([...fresh.values()]);
    for (const key of fresh.keys()) cache.set(key, batch);
  }
  const pending = new Set(requests.map((request) => cache.get(requestKey(request))!));
  const loaded = await Promise.all(pending);
  return Object.assign({}, ...loaded.map((entry) => entry.routes)) as Record<string, OfficeFontFallbackRoute>;
}

/** Every distinct load in the cache (one batch backs several tuples). */
export function distinctOfficeRouteLoads(cache: OfficeRouteCache): Promise<LoadedOfficeFontFallbacks>[] {
  return [...new Set(cache.values())];
}
