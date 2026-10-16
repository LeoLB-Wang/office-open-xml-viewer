import {
  normalizeLocalFontMetricFamily,
  type OfficeFontFallbackRequest,
  type OfficeFontFallbackRoute,
} from '@silurus/ooxml-core';

type LoadedOfficeFontFallbacks = {
  faces: FontFace[];
  routes: Record<string, OfficeFontFallbackRoute>;
  installed?: string[];
};

export interface AcquiredOfficeRoutes {
  routes: Record<string, OfficeFontFallbackRoute>;
  /** Normalized requested families with any installed face (presence probes). */
  installed: string[];
}

export type OfficeRouteCache = Map<string, Promise<LoadedOfficeFontFallbacks>>;

function requestKey(request: OfficeFontFallbackRequest): string {
  const family = normalizeLocalFontMetricFamily(request.family);
  return request.presenceOnly ? `presence:${family}` : `${family}:${request.weight ?? 400}:${request.style ?? 'normal'}`;
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
): Promise<AcquiredOfficeRoutes> {
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
  const available = Object.assign({}, ...loaded.map((entry) => entry.routes)) as Record<string, OfficeFontFallbackRoute>;
  // A batch may hold routes for tuples another slide requested; return only
  // this call's tuples so what the renderer knows never depends on history.
  const installedAnywhere = new Set(loaded.flatMap((entry) => entry.installed ?? []));
  const routes: Record<string, OfficeFontFallbackRoute> = {};
  const installed = new Set<string>();
  for (const request of requests) {
    if (request.presenceOnly) {
      const family = normalizeLocalFontMetricFamily(request.family);
      if (installedAnywhere.has(family)) installed.add(family);
      continue;
    }
    const key = routeKeyFor(request);
    if (available[key]) routes[key] = available[key];
  }
  return { routes, installed: [...installed].sort() };
}

/** The core office-fallback route key (regular tuples key by family alone). */
function routeKeyFor(request: OfficeFontFallbackRequest): string {
  const family = normalizeLocalFontMetricFamily(request.family);
  const weight = request.weight ?? 400;
  const style = request.style ?? 'normal';
  return weight === 400 && style === 'normal' ? family : `${family}:${weight}:${style}`;
}

/** Every distinct load in the cache (one batch backs several tuples). */
export function distinctOfficeRouteLoads(cache: OfficeRouteCache): Promise<LoadedOfficeFontFallbacks>[] {
  return [...new Set(cache.values())];
}
