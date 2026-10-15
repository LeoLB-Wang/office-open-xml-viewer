import { isOwnedPaintResourceSession } from './resource-session.js';

/** A self-contained source sidecar must admit sessions with the painting
 * realm's identity check. Keep this binding free of layout/source imports. */
export const readingPaintOwners = { isOwnedPaintResourceSession };
