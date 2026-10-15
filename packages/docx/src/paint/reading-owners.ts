/** Paint admission binds only resource identity and drawable inspection.
 * Keep layout/source acquisition outside this contract and avoid bundling a
 * second copy of the worker's resource-session implementation. */
export interface ReadingPaintOwners {
  readonly isOwnedPaintResourceSession: typeof import('./resource-session.js').isOwnedPaintResourceSession;
  readonly isUnavailablePaintResourceHandle: typeof import('./resource-session.js').isUnavailablePaintResourceHandle;
  readonly imageNaturalSize: typeof import('@silurus/ooxml-core').imageNaturalSize;
}
export let readingPaintOwners: ReadingPaintOwners;
export function bindReadingPaintOwners(owners: ReadingPaintOwners): void {
  readingPaintOwners = owners;
}
